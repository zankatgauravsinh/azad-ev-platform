import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PurchaseOrderLineKind } from '@azad/shared';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';

type Tx = Prisma.TransactionClient;

export interface LockedOrderLine {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  vendorId: string;
  status: string;
  kind: PurchaseOrderLineKind;
  variantId: string | null;
  accessoryId: string | null;
  description: string;
  quantity: number;
  unitCost: bigint;
  gstRateBp: number;
  /** Already received against it (before this receipt). */
  received: number;
}

/**
 * Receiving stock against purchase-order lines: a scooter added from a scooter line, accessories bought from an
 * accessory line. The line is locked for the rest of the caller's transaction and what it already received is
 * counted (live scooters linked to it; pieces on live accessory purchases), so two receipts cannot both take the
 * last piece. A fully received order closes itself.
 */
@Injectable()
export class PurchaseOrderReceiptsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  async lockLine(tx: Tx, lineId: string, kind: PurchaseOrderLineKind): Promise<LockedOrderLine> {
    const companyId = this.tenant.requireCompanyId();
    const [line] = await tx.$queryRaw<Omit<LockedOrderLine, 'received'>[]>`
      SELECT l.id, l."purchaseOrderId", po."poNumber", po."vendorId", po.status::text AS status, l.kind::text AS kind, l."variantId", l."accessoryId",
             l.description, l.quantity, l."unitCost", l."gstRateBp"
      FROM "PurchaseOrderLine" l JOIN "PurchaseOrder" po ON po.id = l."purchaseOrderId"
      WHERE l.id = ${lineId} AND po."companyId" = ${companyId}
      FOR UPDATE OF l`;
    if (!line) throw new NotFoundException('Purchase order line not found');
    if (line.kind !== kind) throw new BadRequestException(`That line of ${line.poNumber} is not ${kind === 'SCOOTER' ? 'a scooter' : 'an accessory'}`);
    if (line.status !== 'ORDERED') {
      throw new ConflictException(line.status === 'DRAFT' ? `${line.poNumber} is still a draft — mark it ordered first` : `${line.poNumber} is ${line.status.toLowerCase()} — nothing more can be received against it`);
    }
    return { ...line, received: await this.received(tx, line.id, kind) };
  }

  async received(tx: Tx, lineId: string, kind: PurchaseOrderLineKind): Promise<number> {
    if (kind === 'SCOOTER') return tx.inventoryUnit.count({ where: { purchaseOrderLineId: lineId } });
    const agg = await tx.accessoryPurchaseItem.aggregate({ _sum: { quantity: true }, where: { purchaseOrderLineId: lineId, purchase: { status: 'ACTIVE' } } });
    return agg._sum.quantity ?? 0;
  }

  /** Refuses a receipt of more than the line still expects. */
  assertRoom(line: LockedOrderLine, quantity: number): void {
    const left = line.quantity - line.received;
    if (quantity > left) {
      throw new ConflictException(left <= 0 ? `${line.description} on ${line.poNumber} is fully received` : `Only ${left} more of ${line.description} ${left === 1 ? 'is' : 'are'} expected on ${line.poNumber}`);
    }
  }

  /** Closes the order once every line is fully received. */
  async closeIfComplete(tx: Tx, purchaseOrderId: string, userId: string): Promise<void> {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId }, select: { id: true, kind: true, quantity: true } });
    for (const l of lines) if ((await this.received(tx, l.id, l.kind)) < l.quantity) return;
    const closed = await tx.purchaseOrder.updateMany({ where: { id: purchaseOrderId, status: 'ORDERED' }, data: { status: 'CLOSED', closedAt: new Date(), updatedById: userId } });
    if (closed.count === 1) {
      const order = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId }, select: { poNumber: true } });
      await this.activityLog.recordInTransaction({ action: 'STATUS_CHANGE', source: 'SYSTEM', entityType: 'PurchaseOrder', entityId: purchaseOrderId, entityLabel: order?.poNumber ?? null, summary: `Purchase order ${order?.poNumber ?? ''} closed itself — everything ordered has been received`, changes: { status: { from: 'ORDERED', to: 'CLOSED' } } }, tx);
    }
  }
}
