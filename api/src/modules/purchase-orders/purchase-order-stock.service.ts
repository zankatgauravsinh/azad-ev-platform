import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityAction, computePurchaseCost, type StockCandidateDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { diffFields } from '../../activity-log/audit-diff';
import { PurchaseOrderReceiptsService } from '../vendor-payables/purchase-order-receipts.service';
import { GstFilingService } from '../gst/gst-filing.service';

const calendarDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const UNIT_LINK_FIELDS = ['purchaseOrder', 'vendor', 'purchaseDate', 'purchasePrice', 'purchaseGst', 'purchaseCost'] as const;
type LinkView = Record<(typeof UNIT_LINK_FIELDS)[number], unknown>;

const candidateSelect = {
  id: true, vin: true, status: true, createdAt: true, purchaseDate: true, purchasePrice: true, purchaseGst: true, purchaseCost: true,
  transportCharge: true, vendorId: true, purchaseOrderLineId: true, costInExpenses: true, variantId: true,
  vendor: { select: { name: true } },
} satisfies Prisma.InventoryUnitSelect;
type CandidateRow = Prisma.InventoryUnitGetPayload<{ select: typeof candidateSelect }>;

/**
 * Scooters added to Inventory directly (not received against the order) that belong to a purchase order line —
 * e.g. entered by someone who could not see the order. Linking them counts them as received on the line, puts them
 * on the order's vendor and, when no purchase cost was recorded, gives them the line's price and GST — so the vendor
 * bill and the input GST appear. A cost already recorded (from the bill) is kept.
 */
@Injectable()
export class PurchaseOrderStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly receipts: PurchaseOrderReceiptsService,
    private readonly gstFiling: GstFilingService,
  ) {}

  async candidates(orderId: string, lineId: string): Promise<StockCandidateDto[]> {
    const line = await this.scooterLine(orderId, lineId);
    if (!line.variantId) return [];
    const rows = await this.prisma.inventoryUnit.findMany({ where: this.candidateWhere(line.variantId, line.purchaseOrder.vendorId), select: candidateSelect, orderBy: { createdAt: 'asc' } });
    return rows.map((u) => {
      const costMissing = u.purchasePrice === 0n && u.purchaseGst === 0n;
      return {
        id: u.id, vin: u.vin, status: u.status, addedOn: u.createdAt.toISOString(), purchaseDate: u.purchaseDate?.toISOString() ?? null,
        vendorName: u.vendor?.name ?? null, purchasePrice: u.purchasePrice.toString(), purchaseGst: u.purchaseGst.toString(),
        costMissing, costDiffers: !costMissing && u.purchasePrice !== line.unitCost,
      };
    });
  }

  async link(orderId: string, lineId: string, unitIds: string[], userId: string): Promise<void> {
    const ids = [...new Set(unitIds)];
    const order = await this.scooterLine(orderId, lineId);
    const vendor = await this.prisma.vendor.findFirst({ where: { id: order.purchaseOrder.vendorId }, select: { id: true, name: true } });
    if (!vendor) throw new NotFoundException('The order’s vendor was not found');
    await this.prisma.$transaction(async (tx) => {
      // The line is locked: never more than it still expects, and only while the order is ORDERED.
      const line = await this.receipts.lockLine(tx, lineId, 'SCOOTER');
      this.receipts.assertRoom(line, ids.length);
      await tx.$queryRaw`SELECT id FROM "InventoryUnit" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
      const units = await tx.inventoryUnit.findMany({ where: { id: { in: ids } }, select: candidateSelect });
      if (units.length !== ids.length) throw new NotFoundException('A scooter was not found — reload and pick again');
      for (const u of units) this.assertCandidate(u, line.variantId, vendor.id, order.purchaseOrder.poNumber);

      const today = calendarDay(new Date());
      for (const u of units) {
        const purchaseDate = u.purchaseDate ?? today;
        // Its input credit is claimed in that month's GSTR-3B: a filed month cannot change underneath it.
        await this.gstFiling.assertOpen(purchaseDate, 'GSTR3B', `the purchase bill of scooter ${u.vin}`);
        const costMissing = u.purchasePrice === 0n && u.purchaseGst === 0n;
        const cost = costMissing ? computePurchaseCost(line.unitCost, { rateBp: line.gstRateBp }, u.transportCharge) : null;
        const updated = await tx.inventoryUnit.update({
          where: { id: u.id },
          data: {
            purchaseOrderLine: { connect: { id: line.id } },
            vendor: { connect: { id: vendor.id } },
            supplier: vendor.name,
            purchaseDate,
            ...(cost ?? {}),
            updatedById: userId,
          },
          select: candidateSelect,
        });
        const view = (r: CandidateRow, po: string | null, vendorName: string | null): LinkView => ({
          purchaseOrder: po, vendor: vendorName, purchaseDate: r.purchaseDate, purchasePrice: r.purchasePrice, purchaseGst: r.purchaseGst, purchaseCost: r.purchaseCost,
        });
        await this.activityLog.recordInTransaction({
          actorId: userId, action: ActivityAction.UPDATE, entityType: 'InventoryUnit', entityId: u.id, entityLabel: u.vin,
          summary: `Linked scooter ${u.vin} (already in stock) to purchase order ${line.poNumber} — ${line.description}${cost ? '; purchase price and GST taken from the order' : ''}`,
          changes: diffFields(view(u, null, u.vendor?.name ?? null), view(updated, line.poNumber, vendor.name), UNIT_LINK_FIELDS),
          metadata: { purchaseOrderId: orderId, purchaseOrderLineId: line.id },
        }, tx);
      }
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.UPDATE, entityType: 'PurchaseOrder', entityId: orderId, entityLabel: line.poNumber,
        summary: `Linked ${units.length} scooter${units.length === 1 ? '' : 's'} already in stock to ${line.poNumber} — ${line.description}: ${units.map((u) => u.vin).join(', ')}`,
        metadata: { purchaseOrderLineId: line.id, unitIds: ids },
      }, tx);
      await this.receipts.closeIfComplete(tx, orderId, userId);
    });
  }

  private candidateWhere(variantId: string, vendorId: string): Prisma.InventoryUnitWhereInput {
    return { variantId, purchaseOrderLineId: null, costInExpenses: false, OR: [{ vendorId: null }, { vendorId }] };
  }

  private assertCandidate(u: CandidateRow, variantId: string | null, vendorId: string, poNumber: string): void {
    if (u.purchaseOrderLineId) throw new ConflictException(`Scooter ${u.vin} is already on a purchase order`);
    if (!variantId || u.variantId !== variantId) throw new BadRequestException(`Scooter ${u.vin} is another model / variant / colour than this line of ${poNumber}`);
    if (u.costInExpenses) throw new BadRequestException(`Scooter ${u.vin}'s cost is already recorded as an expense — linking it would bill it twice`);
    if (u.vendorId && u.vendorId !== vendorId) throw new BadRequestException(`Scooter ${u.vin} was bought from ${u.vendor?.name ?? 'another vendor'}, not this order's vendor`);
  }

  private async scooterLine(orderId: string, lineId: string) {
    const line = await this.prisma.purchaseOrderLine.findFirst({
      where: { id: lineId, purchaseOrderId: orderId },
      select: { id: true, kind: true, variantId: true, unitCost: true, purchaseOrder: { select: { vendorId: true, poNumber: true } } },
    });
    if (!line) throw new NotFoundException('Purchase order line not found');
    if (line.kind !== 'SCOOTER') throw new BadRequestException('That line is not a scooter line');
    return line;
  }
}
