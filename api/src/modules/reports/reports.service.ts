import { Injectable } from '@nestjs/common';
import { BookingStatus, PaymentContext, UnitStatus, LeadStatus, RETURN_STATUSES, RETURN_DISPOSITIONS } from '@azad/shared';
import type {
  CustomersReport,
  ExportFormat,
  InventoryReport,
  OverviewReport,
  PaymentsReport,
  ReportKpi,
  ReportRange,
  ReportRangeInput,
  ReportType,
  ReturnDisposition,
  ReturnReportRow,
  ReturnStatus,
  ReturnsReport,
  ReturnsReportQuery,
  SalesReport,
} from '@azad/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ExportService, type ExportData } from '../../export/export.service';
import { PnlService } from '../finance/pnl.service';
import { fillMonths } from '../dashboard/chart-utils';
import { formatInr, formatInrExact } from '../../common/utils/money';

const inr = (paise: string): string => formatInrExact(BigInt(paise));
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

interface Bucket {
  fromDate: Date;
  toDate: Date;
  range: ReportRange;
}

/**
 * Read-only analytics over the whole dealership. Every figure comes from an
 * aggregate / groupBy / count or a single targeted raw SQL join — no N+1.
 * Raw SQL is scoped to the company explicitly (it bypasses the Prisma tenant
 * middleware); Prisma calls are auto-scoped.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly exporter: ExportService,
    private readonly pnl: PnlService,
  ) {}

  private resolveRange(input: ReportRangeInput): Bucket {
    const toDate = input.to ?? new Date();
    const fromDate = input.from ?? new Date(toDate.getTime() - 30 * 86_400_000);
    return { fromDate, toDate, range: { from: fromDate.toISOString(), to: toDate.toISOString() } };
  }

  // ── Overview ───────────────────────────────────────────
  async overview(input: ReportRangeInput): Promise<OverviewReport> {
    const company = this.tenant.requireCompanyId();
    const { fromDate, toDate, range } = this.resolveRange(input);
    const inRange = { gte: fromDate, lte: toDate };

    const [sales, collections, serviceRevenue, customers, activeCustomers, availableUnits, pendingDeliveries, outstanding, monthly, paymentMix] =
      await Promise.all([
        this.prisma.sale.aggregate({ where: { invoicedAt: inRange }, _count: true, _sum: { total: true } }),
        this.prisma.payment.aggregate({ where: { paidAt: inRange }, _sum: { amount: true } }),
        this.prisma.payment.aggregate({ where: { context: PaymentContext.SERVICE, paidAt: inRange }, _sum: { amount: true } }),
        this.prisma.customer.count(),
        this.prisma.customer.count({ where: { leadStatus: { not: LeadStatus.LOST } } }),
        this.prisma.inventoryUnit.count({ where: { status: UnitStatus.AVAILABLE } }),
        this.prisma.booking.count({ where: { status: { not: BookingStatus.CANCELLED }, actualDelivery: null } }),
        this.outstandingBalance(company),
        this.monthlyRevenue(company),
        this.paymentsByMode(fromDate, toDate),
      ]);

    return {
      range,
      kpis: [
        { label: 'Invoiced sales', value: String(sales._count), hint: formatInr(sales._sum.total ?? 0n) },
        { label: 'Revenue (collected)', value: formatInr(collections._sum.amount ?? 0n), tone: 'positive' },
        { label: 'Service revenue', value: formatInr(serviceRevenue._sum.amount ?? 0n) },
        { label: 'Customers', value: String(customers), hint: `${activeCustomers} active` },
        { label: 'Available stock', value: String(availableUnits) },
        { label: 'Pending deliveries', value: String(pendingDeliveries), tone: pendingDeliveries > 0 ? 'warning' : 'default' },
        { label: 'Outstanding payments', value: formatInr(outstanding), tone: outstanding > 0n ? 'danger' : 'default' },
      ],
      monthlyRevenue: monthly,
      paymentMix,
    };
  }

  // ── Sales ──────────────────────────────────────────────
  async sales(input: ReportRangeInput): Promise<SalesReport> {
    const company = this.tenant.requireCompanyId();
    const { fromDate, toDate, range } = this.resolveRange(input);
    const inRange = { gte: fromDate, lte: toDate };

    const [invoiced, bookings, delivered, cancelled, monthly, modelRows, rows] = await Promise.all([
      this.prisma.sale.aggregate({ where: { invoicedAt: inRange }, _count: true, _sum: { total: true } }),
      this.prisma.booking.count({ where: { createdAt: inRange } }),
      this.prisma.booking.count({ where: { actualDelivery: inRange } }),
      this.prisma.booking.count({ where: { status: BookingStatus.CANCELLED, updatedAt: inRange } }),
      this.monthlyRevenue(company),
      this.prisma.$queryRaw<{ name: string; amount: bigint; count: number }[]>`
        SELECT m.name AS name, COALESCE(SUM(s.total),0)::bigint AS amount, COUNT(*)::int AS count
        FROM "Sale" s
        JOIN "InventoryUnit" u ON u.id = s."unitId"
        JOIN "ScooterVariant" v ON v.id = u."variantId"
        JOIN "ScooterModel" m ON m.id = v."modelId"
        WHERE s."deletedAt" IS NULL AND s."companyId" = ${company} AND s."invoicedAt" BETWEEN ${fromDate} AND ${toDate}
        GROUP BY m.name ORDER BY amount DESC`,
      this.prisma.booking.findMany({
        where: { createdAt: inRange },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          code: true,
          createdAt: true,
          status: true,
          total: true,
          customer: { select: { name: true } },
          unit: { select: { vin: true, variant: { select: { name: true, colour: true, model: { select: { name: true } } } } } },
        },
      }),
    ]);

    const revenue = invoiced._sum.total ?? 0n;
    const avg = invoiced._count > 0 ? revenue / BigInt(invoiced._count) : 0n;
    return {
      range,
      kpis: [
        { label: 'Bookings', value: String(bookings) },
        { label: 'Delivered', value: String(delivered), tone: 'positive' },
        { label: 'Cancelled', value: String(cancelled), tone: cancelled > 0 ? 'danger' : 'default' },
        { label: 'Invoiced revenue', value: formatInr(revenue) },
        { label: 'Avg. ticket', value: formatInr(avg) },
      ],
      monthlySales: monthly,
      modelSales: modelRows.map((r) => ({ name: r.name, amount: r.amount.toString(), count: Number(r.count) })),
      rows: rows.map((b) => ({
        code: b.code,
        date: b.createdAt.toISOString(),
        customer: b.customer.name,
        vehicle: `${b.unit.variant.model.name} ${b.unit.variant.name} · ${b.unit.variant.colour}`,
        status: b.status,
        total: b.total.toString(),
      })),
    };
  }

  // ── Customers ──────────────────────────────────────────
  async customers(input: ReportRangeInput): Promise<CustomersReport> {
    const company = this.tenant.requireCompanyId();
    const { fromDate, toDate, range } = this.resolveRange(input);

    const [total, active, newCount, repeat, growthRows, topRows] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.customer.count({ where: { leadStatus: { not: LeadStatus.LOST } } }),
      this.prisma.customer.count({ where: { createdAt: { gte: fromDate, lte: toDate } } }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT "customerId" FROM "Booking" WHERE "companyId" = ${company} AND "deletedAt" IS NULL AND status <> 'CANCELLED'
          GROUP BY "customerId" HAVING COUNT(*) > 1
        ) t`,
      this.prisma.$queryRaw<{ month: string; count: number }[]>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, COUNT(*)::int AS count
        FROM "Customer" WHERE "createdAt" >= date_trunc('month', now()) - interval '5 months' AND "deletedAt" IS NULL AND "companyId" = ${company}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ name: string; phone: string; orders: number; spent: bigint }[]>`
        SELECT c.name AS name, c.phone AS phone, COUNT(b.id)::int AS orders, COALESCE(SUM(b.total),0)::bigint AS spent
        FROM "Customer" c
        JOIN "Booking" b ON b."customerId" = c.id AND b."deletedAt" IS NULL AND b.status <> 'CANCELLED'
        WHERE c."companyId" = ${company} AND c."deletedAt" IS NULL
        GROUP BY c.id, c.name, c.phone ORDER BY spent DESC LIMIT 20`,
    ]);

    const repeatCount = Number(repeat[0]?.count ?? 0n);
    return {
      range,
      kpis: [
        { label: 'Total customers', value: String(total) },
        { label: 'New (period)', value: String(newCount), tone: 'positive' },
        { label: 'Repeat buyers', value: String(repeatCount) },
        { label: 'Active leads', value: String(active) },
      ],
      growth: fillMonths(growthRows.map((r) => ({ month: r.month, amount: 0, count: r.count }))),
      topCustomers: topRows.map((r) => ({ name: r.name, phone: r.phone, orders: Number(r.orders), spent: r.spent.toString() })),
    };
  }

  // ── Inventory ──────────────────────────────────────────
  async inventory(): Promise<InventoryReport> {
    const company = this.tenant.requireCompanyId();

    const [total, available, booked, delivered, stockValue, byModel, lowStock, movement] = await Promise.all([
      this.prisma.inventoryUnit.count(),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.AVAILABLE } }),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.BOOKED } }),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.DELIVERED } }),
      this.prisma.inventoryUnit.aggregate({ where: { status: UnitStatus.AVAILABLE }, _sum: { sellingPrice: true } }),
      this.prisma.$queryRaw<{ model: string; available: number; booked: number; delivered: number; total: number; value: bigint }[]>`
        SELECT m.name AS model,
          COUNT(*) FILTER (WHERE u.status = 'AVAILABLE')::int AS available,
          COUNT(*) FILTER (WHERE u.status = 'BOOKED')::int AS booked,
          COUNT(*) FILTER (WHERE u.status = 'DELIVERED')::int AS delivered,
          COUNT(*)::int AS total,
          COALESCE(SUM(u."sellingPrice") FILTER (WHERE u.status = 'AVAILABLE'),0)::bigint AS value
        FROM "InventoryUnit" u
        JOIN "ScooterVariant" v ON v.id = u."variantId"
        JOIN "ScooterModel" m ON m.id = v."modelId"
        WHERE u."deletedAt" IS NULL AND u."companyId" = ${company}
        GROUP BY m.name ORDER BY total DESC`,
      this.prisma.$queryRaw<{ model: string; variant: string; colour: string; available: number }[]>`
        SELECT m.name AS model, v.name AS variant, v.colour AS colour, COUNT(*)::int AS available
        FROM "InventoryUnit" u
        JOIN "ScooterVariant" v ON v.id = u."variantId"
        JOIN "ScooterModel" m ON m.id = v."modelId"
        WHERE u.status = 'AVAILABLE' AND u."deletedAt" IS NULL AND u."companyId" = ${company}
        GROUP BY m.name, v.name, v.colour HAVING COUNT(*) <= 2 ORDER BY available ASC LIMIT 20`,
      this.prisma.$queryRaw<{ month: string; count: number }[]>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, COUNT(*)::int AS count
        FROM "InventoryUnit" WHERE "createdAt" >= date_trunc('month', now()) - interval '5 months' AND "deletedAt" IS NULL AND "companyId" = ${company}
        GROUP BY 1 ORDER BY 1`,
    ]);

    return {
      kpis: [
        { label: 'Total units', value: String(total) },
        { label: 'Available', value: String(available), tone: 'positive' },
        { label: 'Booked', value: String(booked) },
        { label: 'Delivered', value: String(delivered) },
        { label: 'Stock valuation', value: formatInr(stockValue._sum.sellingPrice ?? 0n) },
      ],
      byModel: byModel.map((r) => ({
        model: r.model,
        available: Number(r.available),
        booked: Number(r.booked),
        delivered: Number(r.delivered),
        total: Number(r.total),
        value: r.value.toString(),
      })),
      lowStock: lowStock.map((r) => ({ model: r.model, variant: r.variant, colour: r.colour, available: Number(r.available) })),
      movement: fillMonths(movement.map((r) => ({ month: r.month, amount: 0, count: r.count }))),
    };
  }

  // ── Payments ───────────────────────────────────────────
  async payments(input: ReportRangeInput): Promise<PaymentsReport> {
    const company = this.tenant.requireCompanyId();
    const { fromDate, toDate, range } = this.resolveRange(input);
    const inRange = { gte: fromDate, lte: toDate };

    const [total, byMode, outstanding, daily, rows] = await Promise.all([
      this.prisma.payment.aggregate({ where: { paidAt: inRange }, _sum: { amount: true }, _count: true }),
      this.paymentsByMode(fromDate, toDate),
      this.outstandingBalance(company),
      this.prisma.$queryRaw<{ date: string; amount: bigint; count: number }[]>`
        SELECT to_char(date_trunc('day', "paidAt"), 'YYYY-MM-DD') AS date, COALESCE(SUM(amount),0)::bigint AS amount, COUNT(*)::int AS count
        FROM "Payment" WHERE "paidAt" >= (now() - interval '13 days')::date AND "companyId" = ${company}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.payment.findMany({
        where: { paidAt: inRange },
        orderBy: { paidAt: 'desc' },
        take: 500,
        select: { receiptNumber: true, paidAt: true, mode: true, context: true, amount: true, booking: { select: { customer: { select: { name: true } } } }, sale: { select: { customer: { select: { name: true } } } } },
      }),
    ]);

    const byModeMap = new Map(byMode.map((m) => [m.name, m.amount]));
    return {
      range,
      kpis: [
        { label: 'Collected (period)', value: formatInr(total._sum.amount ?? 0n), tone: 'positive' },
        { label: 'Cash', value: formatInr(BigInt(byModeMap.get('CASH') ?? '0')) },
        { label: 'UPI', value: formatInr(BigInt(byModeMap.get('UPI') ?? '0')) },
        { label: 'Bank / Card', value: formatInr(BigInt(byModeMap.get('BANK_TRANSFER') ?? '0') + BigInt(byModeMap.get('CARD') ?? '0')) },
        { label: 'Receipts', value: String(total._count) },
        { label: 'Outstanding', value: formatInr(outstanding), tone: outstanding > 0n ? 'danger' : 'default' },
      ],
      byMode,
      daily: this.fillDays(daily),
      rows: rows.map((p) => ({
        receipt: p.receiptNumber ?? '—',
        date: p.paidAt.toISOString(),
        customer: p.booking?.customer.name ?? p.sale?.customer.name ?? '—',
        mode: p.mode,
        context: p.context,
        amount: p.amount.toString(),
      })),
    };
  }

  // ── Shared helpers ─────────────────────────────────────
  private async monthlyRevenue(company: string) {
    const rows = await this.prisma.$queryRaw<{ month: string; amount: bigint; count: number }[]>`
      SELECT to_char(date_trunc('month', "invoicedAt"), 'YYYY-MM') AS month, COALESCE(SUM(total),0)::bigint AS amount, COUNT(*)::int AS count
      FROM "Sale" WHERE "invoicedAt" >= date_trunc('month', now()) - interval '5 months' AND "deletedAt" IS NULL AND "companyId" = ${company}
      GROUP BY 1 ORDER BY 1`;
    return fillMonths(rows);
  }

  private async paymentsByMode(fromDate: Date, toDate: Date) {
    const rows = await this.prisma.payment.groupBy({
      by: ['mode'],
      where: { paidAt: { gte: fromDate, lte: toDate } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ name: r.mode, amount: (r._sum.amount ?? 0n).toString(), count: r._count._all }))
      .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
  }

  /** Sum of unpaid balances across non-cancelled bookings (total − payments). */
  private async outstandingBalance(company: string): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<{ outstanding: bigint }[]>`
      SELECT COALESCE(SUM(b.total - COALESCE(p.paid, 0)), 0)::bigint AS outstanding
      FROM "Booking" b
      LEFT JOIN (SELECT "bookingId", SUM(amount) AS paid FROM "Payment" WHERE "bookingId" IS NOT NULL GROUP BY "bookingId") p ON p."bookingId" = b.id
      WHERE b."deletedAt" IS NULL AND b.status <> 'CANCELLED' AND b."companyId" = ${company} AND b.total > COALESCE(p.paid, 0)`;
    return row?.outstanding ?? 0n;
  }

  private fillDays(rows: { date: string; amount: bigint; count: number }[]) {
    const byDay = new Map(rows.map((r) => [r.date, r]));
    const out = [];
    const now = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const row = byDay.get(key);
      out.push({
        date: key,
        label: `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`,
        amount: (row?.amount ?? 0n).toString(),
        count: Number(row?.count ?? 0),
      });
    }
    return out;
  }

  // ── Export (PDF / Excel / CSV) ─────────────────────────
  // ── Vehicle returns report ─────────────────────────────
  /**
   * Returns report + summary (tenant-scoped like every other report). Financial figures come
   * straight from the Return/CreditNote/Refund records (Group 4/5) — nothing is recalculated:
   * refundAmount = Σ Refund, deduction = Return.deductionAmount, saleTotal = Sale.total,
   * amountPaid = Σ payments (advance + sale). Breakdowns are computed from the filtered rows.
   */
  async returns(query: ReturnsReportQuery): Promise<ReturnsReport> {
    const { from, to } = this.range(query);
    const rows = await this.returnRows(query);

    const byStatus = RETURN_STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length }));
    const completed = rows.filter((r) => r.status === 'COMPLETED');
    const byDisposition = RETURN_DISPOSITIONS.map((disposition) => ({ disposition, count: completed.filter((r) => r.disposition === disposition).length }));
    const totalRefund = rows.reduce((a, r) => a + BigInt(r.refundAmount), 0n);
    const totalDeduction = rows.reduce((a, r) => a + BigInt(r.deduction), 0n);
    const disp = (d: ReturnDisposition): number => byDisposition.find((x) => x.disposition === d)?.count ?? 0;

    const monthly = new Map<string, number>();
    for (const r of rows) {
      const key = r.requestedDate.slice(0, 7);
      monthly.set(key, (monthly.get(key) ?? 0) + 1);
    }
    const byMonth = fillMonths([...monthly].map(([month, count]) => ({ month, amount: 0n, count })), to);

    const kpis: ReportKpi[] = [
      { label: 'Total returns', value: String(rows.length) },
      { label: 'Completed', value: String(completed.length) },
      { label: 'Total refunds', value: inr(String(totalRefund)) },
      { label: 'Total deductions', value: inr(String(totalDeduction)) },
      { label: 'Returned → Available', value: String(disp('AVAILABLE')), tone: 'positive' },
      { label: 'Returned → In service', value: String(disp('IN_SERVICE')) },
      { label: 'Scrapped', value: String(disp('SCRAP')), tone: disp('SCRAP') > 0 ? 'warning' : 'default' },
    ];

    return { range: { from: from.toISOString(), to: to.toISOString() }, kpis, byStatus, byDisposition, byMonth, rows };
  }

  /** Row builder shared by the report and its export, so both always match exactly. */
  private async returnRows(query: ReturnsReportQuery): Promise<ReturnReportRow[]> {
    const { from, to } = this.range(query);
    const where: Prisma.VehicleReturnWhereInput = { requestedAt: { gte: from, lte: to } };
    if (query.status) where.status = query.status;
    if (query.disposition) where.disposition = query.disposition;
    if (query.customerId) where.customerId = query.customerId;
    if (query.unitId) where.unitId = query.unitId;
    if (query.saleId) where.saleId = query.saleId;

    const returns = await this.prisma.vehicleReturn.findMany({
      where,
      include: {
        sale: { select: { invoiceNumber: true, total: true } },
        booking: { select: { code: true } },
        unit: { select: { vin: true } },
        customer: { select: { name: true } },
        creditNote: { select: { creditNoteNumber: true } },
        refunds: { select: { refundNumber: true, amount: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 5000,
    });

    // Batched amountPaid: a payment belongs to exactly one return (via its booking or sale).
    const bToReturn = new Map(returns.map((r) => [r.bookingId, r.id]));
    const sToReturn = new Map(returns.map((r) => [r.saleId, r.id]));
    const pays = await this.prisma.payment.findMany({
      where: { OR: [{ bookingId: { in: returns.map((r) => r.bookingId) } }, { saleId: { in: returns.map((r) => r.saleId) } }] },
      select: { bookingId: true, saleId: true, amount: true },
    });
    const paidByReturn = new Map<string, bigint>();
    for (const p of pays) {
      let rid: string | undefined;
      if (p.bookingId) rid = bToReturn.get(p.bookingId);
      if (!rid && p.saleId) rid = sToReturn.get(p.saleId);
      if (rid) paidByReturn.set(rid, (paidByReturn.get(rid) ?? 0n) + p.amount);
    }

    const names = await this.userNames(returns.map((r) => r.approvedById));

    return returns.map((r) => ({
      returnNumber: r.returnNumber,
      requestedDate: r.requestedAt.toISOString(),
      completedDate: r.completedAt?.toISOString() ?? null,
      customer: r.customer.name,
      invoiceNumber: r.sale.invoiceNumber,
      bookingCode: r.booking.code,
      vin: r.unit.vin,
      status: r.status as ReturnStatus,
      reason: r.reason,
      inspectionOk: r.inspectionOk,
      approvedBy: r.approvedById ? names.get(r.approvedById) ?? null : null,
      disposition: r.disposition as ReturnDisposition | null,
      saleTotal: r.sale.total.toString(),
      amountPaid: (paidByReturn.get(r.id) ?? 0n).toString(),
      deduction: r.deductionAmount.toString(),
      refundAmount: r.refunds.reduce((a, f) => a + f.amount, 0n).toString(),
      creditNoteNumber: r.creditNote?.creditNoteNumber ?? null,
      refundNumber: r.refunds[0]?.refundNumber ?? null,
    }));
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async returnsExport(query: ReturnsReportQuery): Promise<ExportData> {
    const rows = await this.returnRows(query);
    return {
      title: 'Vehicle Returns Report',
      columns: [
        { header: 'Return', width: 2 }, { header: 'Requested', width: 2 }, { header: 'Customer', width: 3 },
        { header: 'Invoice', width: 2 }, { header: 'Booking', width: 2 }, { header: 'VIN', width: 2 },
        { header: 'Status', width: 2 }, { header: 'Inspection', width: 1 }, { header: 'Approved by', width: 2 },
        { header: 'Completed', width: 2 }, { header: 'Disposition', width: 2 }, { header: 'Sale total', width: 2 },
        { header: 'Paid', width: 2 }, { header: 'Deduction', width: 2 }, { header: 'Refund', width: 2 },
        { header: 'Credit note', width: 2 }, { header: 'Refund no.', width: 2 }, { header: 'Reason', width: 3 },
      ],
      rows: rows.map((r) => [
        r.returnNumber, day(r.requestedDate), r.customer, r.invoiceNumber ?? '—', r.bookingCode, r.vin,
        r.status, r.inspectionOk === null ? '—' : r.inspectionOk ? 'OK' : 'Issues', r.approvedBy ?? '—',
        r.completedDate ? day(r.completedDate) : '—', r.disposition ?? '—', inr(r.saleTotal),
        inr(r.amountPaid), inr(r.deduction), inr(r.refundAmount), r.creditNoteNumber ?? '—', r.refundNumber ?? '—', r.reason,
      ]),
    };
  }

  async export(type: ReportType, format: ExportFormat, input: ReturnsReportQuery): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const data = await this.buildExportData(type, input);
    const buffer =
      format === 'excel' ? await this.exporter.toExcel(data) : format === 'csv' ? this.exporter.toCsv(data) : await this.exporter.toPdf(data);
    const ext = format === 'excel' ? 'xlsx' : format;
    const contentType =
      format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : format === 'csv'
          ? 'text/csv'
          : 'application/pdf';
    return { buffer, filename: `${type}-report-${new Date().toISOString().slice(0, 10)}.${ext}`, contentType };
  }

  private async buildExportData(type: ReportType, input: ReturnsReportQuery): Promise<ExportData> {
    switch (type) {
      case 'sales': {
        const r = await this.sales(input);
        return {
          title: 'Sales Report',
          columns: [{ header: 'Booking', width: 2 }, { header: 'Date', width: 2 }, { header: 'Customer', width: 3 }, { header: 'Vehicle', width: 4 }, { header: 'Status', width: 2 }, { header: 'Total', width: 2 }],
          rows: r.rows.map((x) => [x.code, day(x.date), x.customer, x.vehicle, x.status, inr(x.total)]),
        };
      }
      case 'customers': {
        const r = await this.customers(input);
        return {
          title: 'Customer Report',
          columns: [{ header: 'Customer', width: 3 }, { header: 'Phone', width: 2 }, { header: 'Orders', width: 1 }, { header: 'Total spent', width: 2 }],
          rows: r.topCustomers.map((x) => [x.name, x.phone, x.orders, inr(x.spent)]),
        };
      }
      case 'inventory': {
        const r = await this.inventory();
        return {
          title: 'Inventory Report',
          columns: [{ header: 'Model', width: 3 }, { header: 'Available', width: 1 }, { header: 'Booked', width: 1 }, { header: 'Delivered', width: 1 }, { header: 'Total', width: 1 }, { header: 'Stock value', width: 2 }],
          rows: r.byModel.map((x) => [x.model, x.available, x.booked, x.delivered, x.total, inr(x.value)]),
        };
      }
      case 'payments': {
        const r = await this.payments(input);
        return {
          title: 'Payments Report',
          columns: [{ header: 'Receipt', width: 2 }, { header: 'Date', width: 2 }, { header: 'Customer', width: 3 }, { header: 'Mode', width: 2 }, { header: 'Context', width: 2 }, { header: 'Amount', width: 2 }],
          rows: r.rows.map((x) => [x.receipt, day(x.date), x.customer, x.mode.replace(/_/g, ' '), x.context.replace(/_/g, ' '), inr(x.amount)]),
        };
      }
      case 'warranty':
        return this.warrantyExport();
      case 'amc':
        return this.amcExport();
      case 'expenses':
        return this.expensesExport(input);
      case 'income':
        return this.incomeExport(input);
      case 'vendors':
        return this.vendorsExport();
      case 'bank':
        return this.bankExport(input);
      case 'pnl':
        return this.pnlExport(input);
      case 'gst':
        return this.gstExport(input);
      case 'deliveries':
        return this.deliveriesExport(input);
      case 'returns':
        return this.returnsExport(input);
    }
  }

  private async deliveriesExport(input: ReportRangeInput): Promise<ExportData> {
    const { from, to } = this.range(input);
    const rows = await this.prisma.booking.findMany({
      where: { actualDelivery: { gte: from, lte: to } },
      include: {
        customer: { select: { name: true, phone: true } },
        unit: { select: { vin: true, variant: { select: { name: true, model: { select: { name: true } } } } } },
        sale: { select: { invoiceNumber: true } },
        deliveryExecutive: { select: { name: true } },
      },
      orderBy: { actualDelivery: 'desc' },
      take: 5000,
    });
    return {
      title: 'Delivery Report',
      columns: [{ header: 'Booking', width: 2 }, { header: 'Delivered', width: 2 }, { header: 'Customer', width: 3 }, { header: 'Vehicle', width: 3 }, { header: 'VIN', width: 2 }, { header: 'Invoice', width: 2 }, { header: 'Executive', width: 2 }],
      rows: rows.map((b) => [b.code, day(b.actualDelivery!.toISOString()), b.customer.name, `${b.unit.variant.model.name} ${b.unit.variant.name}`, b.unit.vin, b.sale?.invoiceNumber ?? '—', b.deliveryExecutive?.name ?? '—']),
    };
  }

  private range(input: ReportRangeInput): { from: Date; to: Date } {
    const to = input.to ?? new Date();
    const from = input.from ?? new Date(to.getFullYear(), to.getMonth() - 11, 1);
    return { from, to };
  }

  private async expensesExport(input: ReportRangeInput): Promise<ExportData> {
    const { from, to } = this.range(input);
    const rows = await this.prisma.expense.findMany({
      where: { expenseDate: { gte: from, lte: to } },
      include: { category: { select: { name: true } }, vendor: { select: { name: true } } },
      orderBy: { expenseDate: 'desc' },
      take: 5000,
    });
    return {
      title: 'Expense Report',
      columns: [{ header: 'Number', width: 2 }, { header: 'Date', width: 2 }, { header: 'Category', width: 2 }, { header: 'Vendor', width: 3 }, { header: 'Status', width: 1 }, { header: 'GST', width: 2 }, { header: 'Total', width: 2 }],
      rows: rows.map((e) => [e.expenseNumber, day(e.expenseDate.toISOString()), e.category.name, e.vendor?.name ?? '—', e.status, inr(String(e.gstAmount)), inr(String(e.amount + e.gstAmount))]),
    };
  }

  private async incomeExport(input: ReportRangeInput): Promise<ExportData> {
    const { from, to } = this.range(input);
    const rows = await this.prisma.income.findMany({ where: { incomeDate: { gte: from, lte: to } }, include: { customer: { select: { name: true } } }, orderBy: { incomeDate: 'desc' }, take: 5000 });
    return {
      title: 'Income Report',
      columns: [{ header: 'Number', width: 2 }, { header: 'Date', width: 2 }, { header: 'Source', width: 3 }, { header: 'Customer', width: 3 }, { header: 'Total', width: 2 }],
      rows: rows.map((i) => [i.incomeNumber, day(i.incomeDate.toISOString()), i.source.replace(/_/g, ' '), i.customer?.name ?? '—', inr(String(i.amount + i.gstAmount))]),
    };
  }

  private async vendorsExport(): Promise<ExportData> {
    const vendors = await this.prisma.vendor.findMany({ orderBy: { name: 'asc' }, take: 5000 });
    const totals = await this.prisma.expense.groupBy({ by: ['vendorId'], where: { vendorId: { not: null }, status: { not: 'REJECTED' } }, _sum: { amount: true, gstAmount: true } });
    const totalOf = new Map(totals.map((t) => [t.vendorId, (t._sum.amount ?? 0n) + (t._sum.gstAmount ?? 0n)]));
    const unpaid = await this.prisma.expense.groupBy({ by: ['vendorId'], where: { vendorId: { not: null }, status: 'APPROVED', paid: false }, _sum: { amount: true, gstAmount: true } });
    const dueOf = new Map(unpaid.map((t) => [t.vendorId, (t._sum.amount ?? 0n) + (t._sum.gstAmount ?? 0n)]));
    return {
      title: 'Vendor Report',
      columns: [{ header: 'Number', width: 2 }, { header: 'Vendor', width: 3 }, { header: 'Mobile', width: 2 }, { header: 'GSTIN', width: 2 }, { header: 'Purchases', width: 2 }, { header: 'Outstanding', width: 2 }],
      rows: vendors.map((v) => [v.vendorNumber, v.name, v.mobile ?? '—', v.gstNumber ?? '—', inr(String(totalOf.get(v.id) ?? 0n)), inr(String(dueOf.get(v.id) ?? 0n))]),
    };
  }

  private async bankExport(input: ReportRangeInput): Promise<ExportData> {
    const { from, to } = this.range(input);
    const rows = await this.prisma.bankTransaction.findMany({ where: { txnDate: { gte: from, lte: to } }, orderBy: { txnDate: 'desc' }, take: 5000 });
    return {
      title: 'Bank Statement',
      columns: [{ header: 'Number', width: 2 }, { header: 'Date', width: 2 }, { header: 'Type', width: 2 }, { header: 'Direction', width: 2 }, { header: 'Bank', width: 3 }, { header: 'Amount', width: 2 }],
      rows: rows.map((b) => [b.txnNumber, day(b.txnDate.toISOString()), b.type, b.direction, b.bankName ?? '—', inr(String(b.amount))]),
    };
  }

  private async pnlExport(input: ReportRangeInput): Promise<ExportData> {
    const pnl = await this.pnl.pnl(input);
    const rows: (string | number)[][] = [
      ...pnl.income.map((l) => ['Income', l.label, inr(l.amount)]),
      ['', 'Total income', inr(pnl.totalIncome)],
      ...pnl.expenses.map((l) => ['Expense', l.label, inr(l.amount)]),
      ['', 'Total expense', inr(pnl.totalExpense)],
      ['', 'Cost of goods', inr(pnl.costOfGoods)],
      ['', 'Gross profit', inr(pnl.grossProfit)],
      ['', 'Net profit', inr(pnl.netProfit)],
    ];
    return { title: 'Profit & Loss', columns: [{ header: 'Section', width: 2 }, { header: 'Line', width: 4 }, { header: 'Amount', width: 2 }], rows };
  }

  private async gstExport(input: ReportRangeInput): Promise<ExportData> {
    const { from, to } = this.range(input);
    const [incomeGst, expenseGst] = await Promise.all([
      this.prisma.income.aggregate({ _sum: { gstAmount: true }, where: { incomeDate: { gte: from, lte: to } } }),
      this.prisma.expense.aggregate({ _sum: { gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to } } }),
    ]);
    const output = incomeGst._sum.gstAmount ?? 0n;
    const input2 = expenseGst._sum.gstAmount ?? 0n;
    return {
      title: 'GST Summary',
      columns: [{ header: 'Head', width: 4 }, { header: 'GST', width: 2 }],
      rows: [
        ['Output GST (on income)', inr(String(output))],
        ['Input GST (on expenses)', inr(String(input2))],
        ['Net GST payable', inr(String(output - input2))],
      ],
    };
  }

  private async warrantyExport(): Promise<ExportData> {
    const now = new Date();
    const rows = await this.prisma.warranty.findMany({
      include: { customer: { select: { name: true } }, unit: { select: { vin: true, variant: { select: { name: true, model: { select: { name: true } } } } } } },
      orderBy: { endDate: 'asc' },
      take: 5000,
    });
    return {
      title: 'Warranty Report',
      columns: [{ header: 'Warranty', width: 2 }, { header: 'Customer', width: 3 }, { header: 'Vehicle', width: 3 }, { header: 'VIN', width: 2 }, { header: 'Status', width: 1 }, { header: 'Expiry', width: 2 }, { header: 'Days left', width: 1 }],
      rows: rows.map((w) => [w.warrantyNumber, w.customer.name, `${w.unit.variant.model.name} ${w.unit.variant.name}`, w.unit.vin, w.status, day(w.endDate.toISOString()), Math.ceil((w.endDate.getTime() - now.getTime()) / 86_400_000)]),
    };
  }

  private async amcExport(): Promise<ExportData> {
    const rows = await this.prisma.amcPlan.findMany({
      include: { customer: { select: { name: true } }, unit: { select: { vin: true } } },
      orderBy: { endDate: 'asc' },
      take: 5000,
    });
    return {
      title: 'AMC Report',
      columns: [{ header: 'AMC', width: 2 }, { header: 'Plan', width: 1 }, { header: 'Customer', width: 3 }, { header: 'VIN', width: 2 }, { header: 'Status', width: 1 }, { header: 'Visits', width: 1 }, { header: 'Value', width: 2 }, { header: 'Expiry', width: 2 }],
      rows: rows.map((a) => [a.amcNumber, a.planType, a.customer.name, a.unit.vin, a.status, `${a.visitsUsed}/${a.visitsIncluded}`, inr(String(a.price)), day(a.endDate.toISOString())]),
    };
  }
}
