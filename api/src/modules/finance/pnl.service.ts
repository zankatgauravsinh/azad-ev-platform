import { Injectable } from '@nestjs/common';
import { type GstSummaryDto, type GstSummaryQuery, type ProfitLossDto, type ProfitLossLine, type PnlQuery } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { utcTimestamp } from '../../prisma/sql-time';
import { TenantContext } from '../../tenant/tenant-context.service';
import { fillMonths } from '../dashboard/chart-utils';
import { financialYear, sumBig } from './finance.helpers';
import { GstService } from '../gst/gst.service';

@Injectable()
export class PnlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly gst: GstService,
  ) {}

  /**
   * GST collected (output tax on every invoice, net of credit notes, plus other income with GST) vs paid
   * (eligible input credit on purchase bills), with a monthly breakdown — from the same engine as the GST returns.
   */
  async gstSummary(query: GstSummaryQuery): Promise<GstSummaryDto> {
    const settings = await this.prisma.companySetting.findFirst();
    const now = new Date();
    const fy = financialYear(now, settings?.financialYearStartMonth ?? 4);
    const from = query.from ?? fy.from;
    const to = query.to ?? fy.to;
    const months = await this.gst.monthlyTotals(from, new Date(to.getTime() + 1));
    const collected = months.reduce((t, m) => t + m.output, 0n);
    const paid = months.reduce((t, m) => t + m.input, 0n);
    const collectedMonths = fillMonths(months.map((m) => ({ month: m.month, amount: m.output, count: 0 })), now);
    const paidMonths = fillMonths(months.map((m) => ({ month: m.month, amount: m.input, count: 0 })), now);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      collected: String(collected),
      paid: String(paid),
      difference: String(collected - paid),
      monthly: collectedMonths.map((c, i) => {
        const p = BigInt(paidMonths[i]?.amount ?? '0');
        const col = BigInt(c.amount);
        return { month: c.month, label: c.label, collected: String(col), paid: String(p), difference: String(col - p) };
      }),
    };
  }

  async pnl(query: PnlQuery): Promise<ProfitLossDto> {
    const settings = await this.prisma.companySetting.findFirst();
    const now = new Date();
    const fy = financialYear(now, settings?.financialYearStartMonth ?? 4);
    const from = query.from ?? fy.from;
    const to = query.to ?? fy.to;

    const company = this.tenant.requireCompanyId();
    const [salesPayments, servicePayments, amc, incomeBySource, expenseByCategory, cogs, salesReturns, accessorySales, accessoryCogs, scooterCogs, scooterReturnsCost] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: { in: ['SALE', 'BOOKING_ADVANCE'] }, paidAt: { gte: from, lte: to } } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: 'SERVICE', paidAt: { gte: from, lte: to } } }),
      this.prisma.amcPlan.aggregate({ _sum: { price: true }, where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.income.groupBy({ by: ['source'], _sum: { amount: true, gstAmount: true }, where: { incomeDate: { gte: from, lte: to } } }),
      this.prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to } } }),
      this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to }, category: { name: 'Vehicle Purchase' } } }),
      // Vehicle-return reversal, cash basis: the Refund (money actually returned) reverses the
      // revenue that was recognized when the customer paid. The CreditNote is the legal/GST
      // document and is deliberately NOT summed here (that would double-count the reversal).
      // An approved deduction stays as retained income by design (paid − deduction = refund).
      // Scooter cost: older scooters reached the books as 'Vehicle Purchase' expenses (purchase-period based, no
      // reversal on a return); scooters bought since per-scooter tracking count as cost when sold (below), and a
      // completed return that puts one back in stock reverses that cost.
      this.prisma.refund.aggregate({ _sum: { amount: true }, where: { returnId: { not: null }, refundedAt: { gte: from, lte: to } } }),
      // Accessory counter sales, invoice basis: what was invoiced before GST on live (not cancelled) invoices, and
      // the cost of those pieces (the average cost when sold) — so the margin is matched. Purchases are stock, not
      // expenses, so they appear only through this cost.
      this.prisma.accessorySale.aggregate({ _sum: { subtotal: true }, where: { status: 'ACTIVE', invoiceDate: { gte: from, lte: to } } }),
      this.prisma.$queryRaw<{ cost: bigint | null }[]>`
        SELECT SUM(i."costAtSale" * i.qty)::bigint AS cost FROM "AccessorySaleItem" i JOIN "AccessorySale" s ON s.id = i."saleId"
        WHERE s."companyId" = ${company} AND s.status = 'ACTIVE' AND s."invoiceDate" >= ${utcTimestamp(from)} AND s."invoiceDate" <= ${utcTimestamp(to)}`,
      // Scooters sold (invoiced) in the period: what they cost before GST — price + transport. Their GST is input
      // GST, not cost. Scooters expensed before per-scooter tracking are left out (already in the expenses).
      this.prisma.$queryRaw<{ cost: bigint | null }[]>`
        SELECT SUM(u."purchasePrice" + u."transportCharge")::bigint AS cost FROM "Sale" s JOIN "InventoryUnit" u ON u.id = s."unitId"
        WHERE s."companyId" = ${company} AND s."deletedAt" IS NULL AND s.status <> 'CANCELLED' AND u."costInExpenses" = false
          AND s."invoicedAt" >= ${utcTimestamp(from)} AND s."invoicedAt" <= ${utcTimestamp(to)}`,
      // …less scooters back in stock from a return completed in the period (a scrapped one stays a cost).
      this.prisma.$queryRaw<{ cost: bigint | null }[]>`
        SELECT SUM(u."purchasePrice" + u."transportCharge")::bigint AS cost FROM "VehicleReturn" r JOIN "InventoryUnit" u ON u.id = r."unitId"
        WHERE r."companyId" = ${company} AND r.status = 'COMPLETED' AND r.disposition IN ('AVAILABLE', 'IN_SERVICE') AND u."costInExpenses" = false
          AND r."completedAt" >= ${utcTimestamp(from)} AND r."completedAt" <= ${utcTimestamp(to)}`,
    ]);

    const salesRevenueGross = salesPayments._sum.amount ?? 0n;
    const returnsTotal = salesReturns._sum.amount ?? 0n;
    const salesRevenue = salesRevenueGross - returnsTotal; // net of refunds (cash-basis reversal)
    const serviceRevenue = servicePayments._sum.amount ?? 0n;
    const amcRevenue = amc._sum.price ?? 0n;
    const accessoryRevenue = accessorySales._sum.subtotal ?? 0n;
    const accessoryCost = accessoryCogs[0]?.cost ?? 0n;
    const scooterCost = (scooterCogs[0]?.cost ?? 0n) - (scooterReturnsCost[0]?.cost ?? 0n);

    const income: ProfitLossLine[] = [{ label: 'Sales revenue', amount: String(salesRevenueGross) }];
    if (returnsTotal > 0n) income.push({ label: 'Less: Sales returns (refunds)', amount: String(-returnsTotal) });
    income.push({ label: 'Accessory sales', amount: String(accessoryRevenue) });
    income.push({ label: 'Service revenue', amount: String(serviceRevenue) });
    income.push({ label: 'AMC revenue', amount: String(amcRevenue) });
    // P&L uses net amounts only — GST is a liability / recoverable credit, not
    // revenue or expense (it is reported separately by gstSummary). Service and AMC
    // are already counted above (payments / AmcPlan), so exclude those sources from
    // the manual income ledger to avoid double counting.
    const COUNTED_ELSEWHERE = new Set<string>(['SERVICE', 'AMC']);
    let otherIncomeTotal = 0n;
    for (const g of incomeBySource) {
      if (COUNTED_ELSEWHERE.has(g.source)) continue;
      const amt = g._sum.amount ?? 0n;
      otherIncomeTotal += amt;
      income.push({ label: this.incomeLabel(g.source), amount: String(amt) });
    }

    const categoryNames = await this.prisma.expenseCategory.findMany({ where: { id: { in: expenseByCategory.map((e) => e.categoryId) } }, select: { id: true, name: true } });
    const nameOf = new Map(categoryNames.map((c) => [c.id, c.name]));
    const expenses: ProfitLossLine[] = expenseByCategory
      .map((e) => ({ label: nameOf.get(e.categoryId) ?? 'Other', _n: e._sum.amount ?? 0n }))
      .sort((a, b) => Number(b._n - a._n))
      .map(({ label, _n }) => ({ label, amount: String(_n) }));
    if (scooterCost !== 0n) expenses.push({ label: 'Scooter cost of sales', amount: String(scooterCost) });
    if (accessoryCost > 0n) expenses.push({ label: 'Accessory cost of sales', amount: String(accessoryCost) });

    const totalIncome = salesRevenue + accessoryRevenue + serviceRevenue + amcRevenue + otherIncomeTotal;
    const totalExpense = sumBig(expenses.map((e) => BigInt(e.amount)));
    const costOfGoods = (cogs._sum.amount ?? 0n) + scooterCost + accessoryCost;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      income,
      expenses,
      totalIncome: String(totalIncome),
      totalExpense: String(totalExpense),
      costOfGoods: String(costOfGoods),
      grossProfit: String(salesRevenue + accessoryRevenue - costOfGoods),
      netProfit: String(totalIncome - totalExpense),
    };
  }

  private incomeLabel(source: string): string {
    return source
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
