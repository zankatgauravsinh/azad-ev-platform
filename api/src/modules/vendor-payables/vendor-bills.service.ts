import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGEING_BUCKETS,
  VENDOR_BILL_KINDS,
  ageingBucketOf,
  type PayablesSummaryDto,
  type UnitStatus,
  type VendorAgeingDto,
  type VendorBillDto,
  type VendorBillKind,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { businessDateOf, resolveTimeZone } from '../../common/utils/business-date';

type Db = PrismaService | Prisma.TransactionClient;

/** The bill kinds a caller may see: scooter and accessory-purchase bills are purchase cost (inventory.cost). */
export const visibleBillKinds = (canSeeCost: boolean): VendorBillKind[] => (canSeeCost ? [...VENDOR_BILL_KINDS] : ['EXPENSE']);

/** A bill as read from the database, before the due date and balance are worked out. */
interface RawBill {
  kind: VendorBillKind;
  id: string;
  vendorId: string;
  number: string;
  vendorBillNumber: string | null;
  description: string | null;
  date: Date;
  dueDate: Date | null;
  amount: bigint;
  allocated: bigint;
  paidDirect: boolean;
  paidAt: Date | null;
  unitStatus: string | null;
  creditDays: number;
}

/** A bill with its figures worked out (bigint), for the services; `toDto` turns it into the API shape. */
export interface VendorBill {
  kind: VendorBillKind;
  id: string;
  vendorId: string;
  number: string;
  vendorBillNumber: string | null;
  description: string;
  date: Date;
  dueDate: Date;
  amount: bigint;
  allocated: bigint;
  balance: bigint;
  paidDirect: boolean;
  paid: boolean;
  paidAt: Date | null;
  daysOverdue: number;
  unitStatus: UnitStatus | null;
}

export interface BillFilter {
  vendorIds?: string[];
  kinds: VendorBillKind[];
  /** Only these bills (to check and lock them before paying). */
  billIds?: { kind: VendorBillKind; id: string }[];
}

const DAY_MS = 86_400_000;
/** Whole days from one calendar day to another (UTC dates of both). */
const daysBetween = (from: Date, to: Date): number =>
  Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / DAY_MS);

/**
 * What the showroom owes its vendors, bill by bill. A bill is a scooter bought from a vendor (its purchase cost —
 * price + GST + transport; scooters expensed before per-scooter tracking are not bills), a live accessory purchase,
 * or an approved expense with that vendor. What vendor payments applied to it (active payments only) is its
 * `allocated`; an accessory purchase or expense marked paid without a vendor payment is paid directly. A bill falls
 * due its vendor's credit days after its date (an expense's own due date wins).
 */
@Injectable()
export class VendorBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async list(filter: BillFilter, db: Db = this.prisma): Promise<VendorBill[]> {
    const companyId = this.tenant.requireCompanyId();
    if (filter.kinds.length === 0 || filter.vendorIds?.length === 0 || filter.billIds?.length === 0) return [];
    const [rows, today] = await Promise.all([this.rawBills(db, companyId, filter), this.businessToday(db)]);
    return rows.map((r) => this.withFigures(r, today));
  }

  async listDtos(filter: BillFilter & { unpaidOnly?: boolean }, db: Db = this.prisma): Promise<VendorBillDto[]> {
    const bills = await this.list(filter, db);
    return bills
      .filter((b) => !filter.unpaidOnly || b.balance > 0n)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.number.localeCompare(b.number))
      .map((b) => this.toDto(b));
  }

  /** Bills due and overdue in buckets — of one vendor, or of all vendors. */
  ageingOf(bills: VendorBill[]): VendorAgeingDto {
    const sums = new Map(AGEING_BUCKETS.map((b) => [b, { amount: 0n, count: 0 }]));
    let totalDue = 0n;
    let overdue = 0n;
    for (const b of bills) {
      if (b.balance <= 0n) continue;
      const bucket = sums.get(ageingBucketOf(b.daysOverdue))!;
      bucket.amount += b.balance;
      bucket.count += 1;
      totalDue += b.balance;
      if (b.daysOverdue > 0) overdue += b.balance;
    }
    return {
      buckets: AGEING_BUCKETS.map((bucket) => ({ bucket, amount: String(sums.get(bucket)!.amount), count: sums.get(bucket)!.count })),
      totalDue: String(totalDue),
      overdue: String(overdue),
    };
  }

  /**
   * Advance left with each vendor: active payments' amounts less what they applied to bills. A caller without
   * purchase cost sees only payments that touch expenses alone (no scooter / accessory bill, no purchase order).
   */
  async advances(vendorIds: string[] | undefined, canSeeCost: boolean, db: Db = this.prisma): Promise<Map<string, bigint>> {
    const companyId = this.tenant.requireCompanyId();
    if (vendorIds?.length === 0) return new Map();
    const rows = await db.$queryRaw<{ vendorId: string; advance: bigint }[]>`
      SELECT p."vendorId", SUM(p.amount - COALESCE(al.applied, 0))::bigint AS advance
      FROM "VendorPayment" p
      LEFT JOIN (SELECT "paymentId", SUM(amount) AS applied FROM "VendorPaymentAllocation" WHERE "companyId" = ${companyId} GROUP BY "paymentId") al ON al."paymentId" = p.id
      WHERE p."companyId" = ${companyId} AND p.status = 'ACTIVE'
        ${vendorIds ? Prisma.sql`AND p."vendorId" = ANY(${vendorIds}::text[])` : Prisma.empty}
        ${canSeeCost ? Prisma.empty : Prisma.sql`AND p."purchaseOrderId" IS NULL AND NOT EXISTS (SELECT 1 FROM "VendorPaymentAllocation" x WHERE x."paymentId" = p.id AND x.kind <> 'EXPENSE')`}
      GROUP BY p."vendorId"`;
    return new Map(rows.map((r) => [r.vendorId, r.advance]));
  }

  /** Owed to vendors across the showroom (finance dashboard): every kind — it is a total, not a price. */
  async payablesSummary(): Promise<PayablesSummaryDto> {
    const [bills, advances] = await Promise.all([this.list({ kinds: [...VENDOR_BILL_KINDS] }), this.advances(undefined, true)]);
    const open = bills.filter((b) => b.balance > 0n);
    return {
      billsDue: String(open.reduce((a, b) => a + b.balance, 0n)),
      overdue: String(open.filter((b) => b.daysOverdue > 0).reduce((a, b) => a + b.balance, 0n)),
      dueIn7Days: open.filter((b) => b.daysOverdue >= -7).length,
      advance: String([...advances.values()].reduce((a, v) => a + v, 0n)),
    };
  }

  /**
   * Locks the bills' rows (in a stable order) for the rest of the transaction, so two payments cannot both settle
   * what is left on a bill.
   */
  async lockBills(tx: Prisma.TransactionClient, bills: { kind: VendorBillKind; id: string }[]): Promise<void> {
    const companyId = this.tenant.requireCompanyId();
    const ids = (kind: VendorBillKind): string[] => [...new Set(bills.filter((b) => b.kind === kind).map((b) => b.id))].sort();
    const units = ids('SCOOTER');
    const purchases = ids('ACCESSORY_PURCHASE');
    const expenses = ids('EXPENSE');
    if (units.length) await tx.$queryRaw`SELECT id FROM "InventoryUnit" WHERE "companyId" = ${companyId} AND id = ANY(${units}::text[]) ORDER BY id FOR UPDATE`;
    if (purchases.length) await tx.$queryRaw`SELECT id FROM "AccessoryPurchase" WHERE "companyId" = ${companyId} AND id = ANY(${purchases}::text[]) ORDER BY id FOR UPDATE`;
    if (expenses.length) await tx.$queryRaw`SELECT id FROM "Expense" WHERE "companyId" = ${companyId} AND id = ANY(${expenses}::text[]) ORDER BY id FOR UPDATE`;
  }

  /**
   * Brings a bill's own paid flags in step with its vendor payments: paid in full → paid, on the date (and, for an
   * accessory purchase, by the method) of the latest payment; otherwise unpaid. Only bills that have (or had)
   * allocations are touched, so a bill paid directly keeps its own record.
   */
  async syncBill(tx: Prisma.TransactionClient, bill: { kind: VendorBillKind; id: string }, userId: string): Promise<void> {
    const companyId = this.tenant.requireCompanyId();
    const column = bill.kind === 'SCOOTER' ? Prisma.sql`a."unitId"` : bill.kind === 'ACCESSORY_PURCHASE' ? Prisma.sql`a."accessoryPurchaseId"` : Prisma.sql`a."expenseId"`;
    const [state] = await tx.$queryRaw<{ allocated: bigint | null; any: bigint; lastPaidAt: Date | null; lastMethod: string | null; lastNumber: string | null }[]>`
      SELECT SUM(a.amount) FILTER (WHERE p.status = 'ACTIVE')::bigint AS allocated,
             COUNT(*)::bigint AS any,
             MAX(GREATEST(p."paidAt", a."appliedAt")) FILTER (WHERE p.status = 'ACTIVE') AS "lastPaidAt",
             (ARRAY_AGG(p.method::text ORDER BY GREATEST(p."paidAt", a."appliedAt") DESC, p."createdAt" DESC) FILTER (WHERE p.status = 'ACTIVE'))[1] AS "lastMethod",
             (ARRAY_AGG(COALESCE(NULLIF(p.reference, ''), p."paymentNumber") ORDER BY GREATEST(p."paidAt", a."appliedAt") DESC, p."createdAt" DESC) FILTER (WHERE p.status = 'ACTIVE'))[1] AS "lastNumber"
      FROM "VendorPaymentAllocation" a JOIN "VendorPayment" p ON p.id = a."paymentId"
      WHERE a."companyId" = ${companyId} AND ${column} = ${bill.id}`;
    if (!state || state.any === 0n) return;
    const allocated = state.allocated ?? 0n;
    if (bill.kind === 'SCOOTER') {
      const unit = await tx.inventoryUnit.findFirstOrThrow({ where: { id: bill.id }, select: { purchaseCost: true } });
      const paid = allocated >= unit.purchaseCost;
      await tx.inventoryUnit.update({ where: { id: bill.id }, data: { purchasePaid: paid, purchasePaidAt: paid ? state.lastPaidAt : null, updatedById: userId } });
    } else if (bill.kind === 'ACCESSORY_PURCHASE') {
      const purchase = await tx.accessoryPurchase.findFirstOrThrow({ where: { id: bill.id }, select: { total: true } });
      const paid = allocated >= purchase.total;
      await tx.accessoryPurchase.update({
        where: { id: bill.id },
        data: paid
          ? { paid: true, paidAt: state.lastPaidAt, paymentMethod: state.lastMethod as Prisma.AccessoryPurchaseUpdateInput['paymentMethod'], paymentReference: state.lastNumber, updatedById: userId }
          : { paid: false, paidAt: null, paymentMethod: null, paymentReference: null, updatedById: userId },
      });
    } else {
      const expense = await tx.expense.findFirstOrThrow({ where: { id: bill.id }, select: { amount: true, gstAmount: true } });
      const paid = allocated >= expense.amount + expense.gstAmount;
      await tx.expense.update({ where: { id: bill.id }, data: { paid, settledDate: paid ? state.lastPaidAt : null, updatedById: userId } });
    }
  }

  /**
   * A bill that stops being one (scooter deleted, purchase cancelled, expense rejected or deleted): what vendor
   * payments applied to it is released and stays with the vendor as an advance. Returns how much was released.
   */
  async releaseAllocations(tx: Prisma.TransactionClient, bill: { kind: VendorBillKind; id: string }): Promise<bigint> {
    const where: Prisma.VendorPaymentAllocationWhereInput =
      bill.kind === 'SCOOTER' ? { unitId: bill.id } : bill.kind === 'ACCESSORY_PURCHASE' ? { accessoryPurchaseId: bill.id } : { expenseId: bill.id };
    const active = await tx.vendorPaymentAllocation.aggregate({ _sum: { amount: true }, where: { ...where, payment: { status: 'ACTIVE' } } });
    await tx.vendorPaymentAllocation.deleteMany({ where });
    return active._sum.amount ?? 0n;
  }

  /** What active vendor payments applied to a bill. */
  async allocatedTo(bill: { kind: VendorBillKind; id: string }, db: Db = this.prisma): Promise<bigint> {
    const where: Prisma.VendorPaymentAllocationWhereInput =
      bill.kind === 'SCOOTER' ? { unitId: bill.id } : bill.kind === 'ACCESSORY_PURCHASE' ? { accessoryPurchaseId: bill.id } : { expenseId: bill.id };
    const agg = await db.vendorPaymentAllocation.aggregate({ _sum: { amount: true }, where: { ...where, payment: { status: 'ACTIVE' } } });
    return agg._sum.amount ?? 0n;
  }

  toDto(b: VendorBill): VendorBillDto {
    return {
      kind: b.kind,
      id: b.id,
      vendorId: b.vendorId,
      number: b.number,
      vendorBillNumber: b.vendorBillNumber,
      description: b.description,
      date: b.date.toISOString(),
      dueDate: b.dueDate.toISOString(),
      amount: String(b.amount),
      allocated: String(b.allocated),
      balance: String(b.balance),
      paid: b.paid,
      paidAt: b.paidAt?.toISOString() ?? null,
      daysOverdue: b.daysOverdue,
      ...(b.unitStatus ? { unitStatus: b.unitStatus } : {}),
    };
  }

  /** Today's calendar date in the company's time zone, as midnight UTC. */
  async businessToday(db: Db = this.prisma): Promise<Date> {
    const s = await db.companySetting.findFirst({ select: { timezone: true } });
    return new Date(`${businessDateOf(new Date(), resolveTimeZone(s?.timezone))}T00:00:00.000Z`);
  }

  private withFigures(r: RawBill, today: Date): VendorBill {
    const dueDate = r.dueDate ?? new Date(r.date.getTime() + r.creditDays * DAY_MS);
    const balance = r.paidDirect ? 0n : r.amount > r.allocated ? r.amount - r.allocated : 0n;
    const paid = balance === 0n;
    return {
      kind: r.kind,
      id: r.id,
      vendorId: r.vendorId,
      number: r.number,
      vendorBillNumber: r.vendorBillNumber,
      description: r.description ?? '',
      date: r.date,
      dueDate,
      amount: r.amount,
      allocated: r.allocated,
      balance,
      paidDirect: r.paidDirect,
      paid,
      paidAt: paid ? r.paidAt : null,
      daysOverdue: paid ? 0 : daysBetween(dueDate, today),
      unitStatus: (r.unitStatus as UnitStatus | null) ?? null,
    };
  }

  private rawBills(db: Db, companyId: string, filter: BillFilter): Promise<RawBill[]> {
    const wants = (kind: VendorBillKind): boolean => filter.kinds.includes(kind) && (!filter.billIds || filter.billIds.some((b) => b.kind === kind));
    const idsOf = (kind: VendorBillKind): string[] | null => (filter.billIds ? filter.billIds.filter((b) => b.kind === kind).map((b) => b.id) : null);
    const vendorFilter = (column: Prisma.Sql): Prisma.Sql => (filter.vendorIds ? Prisma.sql`AND ${column} = ANY(${filter.vendorIds}::text[])` : Prisma.empty);
    const idFilter = (column: Prisma.Sql, kind: VendorBillKind): Prisma.Sql => {
      const ids = idsOf(kind);
      return ids ? Prisma.sql`AND ${column} = ANY(${ids}::text[])` : Prisma.empty;
    };
    const allocated = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`COALESCE((
      SELECT SUM(a.amount) FROM "VendorPaymentAllocation" a JOIN "VendorPayment" p ON p.id = a."paymentId"
      WHERE a."companyId" = ${companyId} AND ${column} AND p.status = 'ACTIVE'), 0)::bigint`;
    const hasActive = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`EXISTS (
      SELECT 1 FROM "VendorPaymentAllocation" a JOIN "VendorPayment" p ON p.id = a."paymentId"
      WHERE a."companyId" = ${companyId} AND ${column} AND p.status = 'ACTIVE')`;

    const parts: Prisma.Sql[] = [];
    if (wants('SCOOTER')) {
      parts.push(Prisma.sql`
        SELECT 'SCOOTER' AS kind, u.id, u."vendorId", u.vin AS number, u."vendorBillNumber",
               (m.brand || ' ' || m.name || ' ' || v.name || ' (' || v.colour || ')') AS description,
               COALESCE(u."purchaseDate", date_trunc('day', u."createdAt")) AS date, NULL::timestamp AS "dueDate",
               u."purchaseCost" AS amount, ${allocated(Prisma.sql`a."unitId" = u.id`)} AS allocated,
               false AS "paidDirect", u."purchasePaidAt" AS "paidAt", u.status::text AS "unitStatus"
        FROM "InventoryUnit" u
        JOIN "ScooterVariant" v ON v.id = u."variantId"
        JOIN "ScooterModel" m ON m.id = v."modelId"
        WHERE u."companyId" = ${companyId} AND u."deletedAt" IS NULL AND u."costInExpenses" = false
          AND u."vendorId" IS NOT NULL AND u."purchaseCost" > 0
          ${vendorFilter(Prisma.sql`u."vendorId"`)} ${idFilter(Prisma.sql`u.id`, 'SCOOTER')}`);
    }
    if (wants('ACCESSORY_PURCHASE')) {
      parts.push(Prisma.sql`
        SELECT 'ACCESSORY_PURCHASE' AS kind, ap.id, ap."vendorId", ap."purchaseNumber" AS number, ap."vendorInvoiceNumber" AS "vendorBillNumber",
               (SELECT string_agg(acc.name || ' × ' || i.quantity, ', ' ORDER BY i.id)
                  FROM "AccessoryPurchaseItem" i JOIN "Accessory" acc ON acc.id = i."accessoryId" WHERE i."purchaseId" = ap.id) AS description,
               ap."purchaseDate" AS date, NULL::timestamp AS "dueDate",
               ap.total AS amount, ${allocated(Prisma.sql`a."accessoryPurchaseId" = ap.id`)} AS allocated,
               (ap.paid AND NOT ${hasActive(Prisma.sql`a."accessoryPurchaseId" = ap.id`)}) AS "paidDirect", ap."paidAt", NULL::text AS "unitStatus"
        FROM "AccessoryPurchase" ap
        WHERE ap."companyId" = ${companyId} AND ap.status = 'ACTIVE' AND ap."vendorId" IS NOT NULL AND ap.total > 0
          ${vendorFilter(Prisma.sql`ap."vendorId"`)} ${idFilter(Prisma.sql`ap.id`, 'ACCESSORY_PURCHASE')}`);
    }
    if (wants('EXPENSE')) {
      parts.push(Prisma.sql`
        SELECT 'EXPENSE' AS kind, e.id, e."vendorId", e."expenseNumber" AS number, e."referenceNumber" AS "vendorBillNumber",
               (c.name || COALESCE(' — ' || NULLIF(e.description, ''), '')) AS description,
               e."expenseDate" AS date, e."dueDate",
               (e.amount + e."gstAmount") AS amount, ${allocated(Prisma.sql`a."expenseId" = e.id`)} AS allocated,
               (e.paid AND NOT ${hasActive(Prisma.sql`a."expenseId" = e.id`)}) AS "paidDirect", COALESCE(e."settledDate", e."expenseDate") AS "paidAt", NULL::text AS "unitStatus"
        FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
        WHERE e."companyId" = ${companyId} AND e."deletedAt" IS NULL AND e.status = 'APPROVED' AND e."vendorId" IS NOT NULL
          AND (e.amount + e."gstAmount") > 0
          ${vendorFilter(Prisma.sql`e."vendorId"`)} ${idFilter(Prisma.sql`e.id`, 'EXPENSE')}`);
    }
    if (parts.length === 0) return Promise.resolve([]);
    return db.$queryRaw<RawBill[]>`
      SELECT b.*, vd."creditDays" FROM (${Prisma.join(parts, ' UNION ALL ')}) b
      JOIN "Vendor" vd ON vd.id = b."vendorId"`;
  }
}
