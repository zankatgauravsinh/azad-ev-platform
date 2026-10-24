import { Injectable } from '@nestjs/common';
import { type FinanceDashboardDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { UTC_NOW } from '../../prisma/sql-time';
import { TenantContext } from '../../tenant/tenant-context.service';
import { fillMonths } from '../dashboard/chart-utils';
import { CashbookService } from './cashbook.service';
import { PnlService } from './pnl.service';
import { dayRange } from './finance.helpers';
import { VendorBillsService } from '../vendor-payables/vendor-bills.service';

interface MonthAmountRow {
  month: string;
  amount: bigint;
}

@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly cashbook: CashbookService,
    private readonly pnl: PnlService,
    private readonly vendorBills: VendorBillsService,
  ) {}

  async dashboard(): Promise<FinanceDashboardDto> {
    const company = this.tenant.requireCompanyId();
    const now = new Date();
    const { start: todayStart, end: todayEnd } = dayRange(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7 = new Date(now.getTime() + 7 * 86_400_000);

    const [
      todayPayments,
      todayIncome,
      todayExpense,
      cashInHand,
      bankBalance,
      monthPnl,
      monthExpense,
      pendingVendor,
      upcoming,
      monthlyExpenseRows,
      monthlyIncomeRows,
      categoryRows,
      vendorRows,
    ] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.income.aggregate({ _sum: { amount: true, gstAmount: true }, where: { incomeDate: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: todayStart, lt: todayEnd } } }),
      this.cashbook.cashInHand(),
      this.cashbook.bankBalance(),
      this.pnl.pnl({ from: monthStart, to: todayEnd }),
      this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: monthStart, lt: todayEnd } } }),
      // Owed to vendors (scooters, accessory purchases, expenses with a vendor) + unpaid expenses without a vendor.
      Promise.all([
        this.vendorBills.payablesSummary(),
        this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', paid: false, vendorId: null } }),
      ]),
      this.prisma.expense.count({ where: { status: 'APPROVED', paid: false, vendorId: null, dueDate: { not: null, lte: in7 } } }),
      this.monthlySeries(company, 'expense'),
      this.monthlySeries(company, 'income'),
      this.prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true, gstAmount: true }, where: { status: 'APPROVED', expenseDate: { gte: monthStart, lt: todayEnd } } }),
      // Everything bought from each vendor: scooters, accessory purchases and expenses (with GST).
      this.vendorBills.list({ kinds: ['SCOOTER', 'ACCESSORY_PURCHASE', 'EXPENSE'] }),
    ]);

    const todayCollection = (todayPayments._sum.amount ?? 0n) + (todayIncome._sum.amount ?? 0n) + (todayIncome._sum.gstAmount ?? 0n);
    const categoryNames = await this.prisma.expenseCategory.findMany({ where: { id: { in: categoryRows.map((c) => c.categoryId) } }, select: { id: true, name: true } });
    const catName = new Map(categoryNames.map((c) => [c.id, c.name]));
    const categoryBreakdown = categoryRows
      .map((c) => ({ name: catName.get(c.categoryId) ?? 'Other', amount: (c._sum.amount ?? 0n) + (c._sum.gstAmount ?? 0n) }))
      .sort((a, b) => Number(b.amount - a.amount))
      .slice(0, 6)
      .map((c) => ({ name: c.name, amount: String(c.amount) }));

    const byVendor = new Map<string, bigint>();
    for (const b of vendorRows) byVendor.set(b.vendorId, (byVendor.get(b.vendorId) ?? 0n) + b.amount);
    const topVendorIds = [...byVendor.entries()]
      .map(([id, amount]) => ({ id, amount }))
      .sort((a, b) => Number(b.amount - a.amount))
      .slice(0, 5);
    const vendorNames = await this.prisma.vendor.findMany({ where: { id: { in: topVendorIds.map((v) => v.id) } }, select: { id: true, name: true } });
    const vName = new Map(vendorNames.map((v) => [v.id, v.name]));
    const topVendors = topVendorIds.map((v) => ({ name: vName.get(v.id) ?? 'Vendor', amount: String(v.amount) }));

    const monthlyExpenses = fillMonths(monthlyExpenseRows.map((r) => ({ month: r.month, amount: r.amount, count: 0 })), now);
    const monthlyIncome = fillMonths(monthlyIncomeRows.map((r) => ({ month: r.month, amount: r.amount, count: 0 })), now);
    const incomeVsExpense = monthlyExpenses.map((e, i) => ({ month: e.month, label: e.label, income: monthlyIncome[i]?.amount ?? '0', expense: e.amount }));

    return {
      todayCollection: String(todayCollection),
      todayExpense: String((todayExpense._sum.amount ?? 0n) + (todayExpense._sum.gstAmount ?? 0n)),
      cashInHand: String(cashInHand),
      bankBalance: String(bankBalance),
      monthProfit: monthPnl.netProfit,
      monthExpense: String((monthExpense._sum.amount ?? 0n) + (monthExpense._sum.gstAmount ?? 0n)),
      pendingVendorPayments: String(BigInt(pendingVendor[0].billsDue) + (pendingVendor[1]._sum.amount ?? 0n) + (pendingVendor[1]._sum.gstAmount ?? 0n)),
      upcomingPayments: upcoming + pendingVendor[0].dueIn7Days,
      monthlyExpenses: monthlyExpenses.map((m) => ({ month: m.month, label: m.label, amount: m.amount })),
      incomeVsExpense,
      categoryBreakdown,
      topVendors,
    };
  }

  /** Last 6 months of expense or income totals, grouped by month (company-scoped raw SQL). */
  private async monthlySeries(company: string, kind: 'expense' | 'income'): Promise<MonthAmountRow[]> {
    if (kind === 'expense') {
      return this.prisma.$queryRaw<MonthAmountRow[]>`
        SELECT to_char(date_trunc('month', "expenseDate"), 'YYYY-MM') AS month, SUM(amount + "gstAmount")::bigint AS amount
        FROM "Expense"
        WHERE "deletedAt" IS NULL AND "companyId" = ${company} AND status = 'APPROVED'
          AND "expenseDate" >= (${UTC_NOW} - interval '6 months')
        GROUP BY 1 ORDER BY 1`;
    }
    return this.prisma.$queryRaw<MonthAmountRow[]>`
      SELECT month, SUM(amount)::bigint AS amount FROM (
        SELECT to_char(date_trunc('month', "incomeDate"), 'YYYY-MM') AS month, (amount + "gstAmount") AS amount
        FROM "Income" WHERE "companyId" = ${company} AND "incomeDate" >= (${UTC_NOW} - interval '6 months')
        UNION ALL
        SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month, amount
        FROM "Payment" WHERE "companyId" = ${company} AND "paidAt" >= (${UTC_NOW} - interval '6 months')
      ) t GROUP BY month ORDER BY month`;
  }
}
