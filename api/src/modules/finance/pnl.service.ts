import { Injectable } from '@nestjs/common';
import { type GstSummaryDto, type GstSummaryQuery, type ProfitLossDto, type ProfitLossLine, type PnlQuery } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { fillMonths } from '../dashboard/chart-utils';
import { financialYear, sumBig } from './finance.helpers';

@Injectable()
export class PnlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  /** GST collected (on income) vs paid (on approved expenses), with a monthly breakdown. */
  async gstSummary(query: GstSummaryQuery): Promise<GstSummaryDto> {
    const company = this.tenant.requireCompanyId();
    const settings = await this.prisma.companySetting.findFirst();
    const now = new Date();
    const fy = financialYear(now, settings?.financialYearStartMonth ?? 4);
    const from = query.from ?? fy.from;
    const to = query.to ?? fy.to;

    const [collectedAgg, paidAgg, monthly] = await Promise.all([
      this.prisma.income.aggregate({ _sum: { gstAmount: true }, where: { incomeDate: { gte: from, lte: to } } }),
      this.prisma.expense.aggregate({ _sum: { gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to } } }),
      this.prisma.$queryRaw<{ month: string; collected: bigint; paid: bigint }[]>`
        SELECT month, SUM(collected)::bigint AS collected, SUM(paid)::bigint AS paid FROM (
          SELECT to_char(date_trunc('month', "incomeDate"), 'YYYY-MM') AS month, "gstAmount" AS collected, 0::bigint AS paid
          FROM "Income" WHERE "companyId" = ${company} AND "incomeDate" >= ${from} AND "incomeDate" <= ${to}
          UNION ALL
          SELECT to_char(date_trunc('month', "expenseDate"), 'YYYY-MM') AS month, 0::bigint AS collected, "gstAmount" AS paid
          FROM "Expense" WHERE "companyId" = ${company} AND "deletedAt" IS NULL AND status = 'APPROVED' AND "expenseDate" >= ${from} AND "expenseDate" <= ${to}
        ) t GROUP BY month ORDER BY month`,
    ]);

    const collected = collectedAgg._sum.gstAmount ?? 0n;
    const paid = paidAgg._sum.gstAmount ?? 0n;
    const collectedMonths = fillMonths(monthly.map((m) => ({ month: m.month, amount: m.collected, count: 0 })), now);
    const paidMonths = fillMonths(monthly.map((m) => ({ month: m.month, amount: m.paid, count: 0 })), now);
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

    const [salesPayments, servicePayments, amc, incomeBySource, expenseByCategory, cogs] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: { in: ['SALE', 'BOOKING_ADVANCE'] }, paidAt: { gte: from, lte: to } } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: 'SERVICE', paidAt: { gte: from, lte: to } } }),
      this.prisma.amcPlan.aggregate({ _sum: { price: true }, where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.income.groupBy({ by: ['source'], _sum: { amount: true, gstAmount: true }, where: { incomeDate: { gte: from, lte: to } } }),
      this.prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to } } }),
      this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: from, lte: to }, category: { name: 'Vehicle Purchase' } } }),
    ]);

    const salesRevenue = salesPayments._sum.amount ?? 0n;
    const serviceRevenue = servicePayments._sum.amount ?? 0n;
    const amcRevenue = amc._sum.price ?? 0n;

    const income: ProfitLossLine[] = [
      { label: 'Sales revenue', amount: String(salesRevenue) },
      { label: 'Service revenue', amount: String(serviceRevenue) },
      { label: 'AMC revenue', amount: String(amcRevenue) },
    ];
    let otherIncomeTotal = 0n;
    for (const g of incomeBySource) {
      const amt = (g._sum.amount ?? 0n) + (g._sum.gstAmount ?? 0n);
      otherIncomeTotal += amt;
      income.push({ label: this.incomeLabel(g.source), amount: String(amt) });
    }

    const categoryNames = await this.prisma.expenseCategory.findMany({ where: { id: { in: expenseByCategory.map((e) => e.categoryId) } }, select: { id: true, name: true } });
    const nameOf = new Map(categoryNames.map((c) => [c.id, c.name]));
    const expenses: ProfitLossLine[] = expenseByCategory
      .map((e) => ({ label: nameOf.get(e.categoryId) ?? 'Other', amount: String((e._sum.amount ?? 0n) + (e._sum.gstAmount ?? 0n)), _n: (e._sum.amount ?? 0n) + (e._sum.gstAmount ?? 0n) }))
      .sort((a, b) => Number(b._n - a._n))
      .map(({ label, amount }) => ({ label, amount }));

    const totalIncome = salesRevenue + serviceRevenue + amcRevenue + otherIncomeTotal;
    const totalExpense = sumBig(expenses.map((e) => BigInt(e.amount)));
    const costOfGoods = (cogs._sum.amount ?? 0n) + (cogs._sum.gstAmount ?? 0n);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      income,
      expenses,
      totalIncome: String(totalIncome),
      totalExpense: String(totalExpense),
      costOfGoods: String(costOfGoods),
      grossProfit: String(salesRevenue - costOfGoods),
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
