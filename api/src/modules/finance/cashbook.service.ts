import { Injectable } from '@nestjs/common';
import {
  type CashBookDto,
  type CashBookRow,
  type CreateCashAdjustmentInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { dayRange } from './finance.helpers';
import { MonthlyClosingService } from './monthly-closing.service';

@Injectable()
export class CashbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
  ) {}

  /** Bank balance = opening + credits − debits (from recorded bank transactions). */
  async bankBalance(): Promise<bigint> {
    const settings = await this.prisma.companySetting.findFirst();
    const groups = await this.prisma.bankTransaction.groupBy({ by: ['direction'], _sum: { amount: true } });
    const credit = groups.find((g) => g.direction === 'CREDIT')?._sum.amount ?? 0n;
    const debit = groups.find((g) => g.direction === 'DEBIT')?._sum.amount ?? 0n;
    return (settings?.openingBank ?? 0n) + credit - debit;
  }

  /** Physical cash in the drawer as of `asOf` (exclusive upper bound). */
  async cashInHand(asOf?: Date): Promise<bigint> {
    const settings = await this.prisma.companySetting.findFirst();
    const before = asOf ? { lt: asOf } : undefined;
    const [income, expense, deposits, withdrawals, cashPayments, adjustments] = await Promise.all([
      this.prisma.income.aggregate({ _sum: { amount: true, gstAmount: true }, where: { paymentMethod: 'CASH', ...(before ? { incomeDate: before } : {}) } }),
      this.prisma.expense.aggregate({ _sum: { amount: true, gstAmount: true }, where: { paymentMethod: 'CASH', status: 'APPROVED', ...(before ? { expenseDate: before } : {}) } }),
      this.prisma.bankTransaction.aggregate({ _sum: { amount: true }, where: { type: 'DEPOSIT', ...(before ? { txnDate: before } : {}) } }),
      this.prisma.bankTransaction.aggregate({ _sum: { amount: true }, where: { type: 'WITHDRAWAL', ...(before ? { txnDate: before } : {}) } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { mode: 'CASH', ...(before ? { paidAt: before } : {}) } }),
      this.prisma.cashAdjustment.aggregate({ _sum: { amount: true }, where: { ...(before ? { adjDate: before } : {}) } }),
    ]);
    const cashIn = (income._sum.amount ?? 0n) + (income._sum.gstAmount ?? 0n) + (withdrawals._sum.amount ?? 0n) + (cashPayments._sum.amount ?? 0n);
    const cashOut = (expense._sum.amount ?? 0n) + (expense._sum.gstAmount ?? 0n) + (deposits._sum.amount ?? 0n);
    return (settings?.openingCash ?? 0n) + cashIn - cashOut + (adjustments._sum.amount ?? 0n);
  }

  async cashBook(date: Date): Promise<CashBookDto> {
    const { start, end } = dayRange(date);
    const opening = await this.cashInHand(start);
    const rows = await this.dayRows(start, end);
    const cashIn = rows.reduce((a, r) => a + BigInt(r.inAmount), 0n);
    const cashOut = rows.reduce((a, r) => a + BigInt(r.outAmount), 0n);
    return {
      date: start.toISOString(),
      opening: String(opening),
      cashIn: String(cashIn),
      cashOut: String(cashOut),
      closing: String(opening + cashIn - cashOut),
      rows,
    };
  }

  async createAdjustment(dto: CreateCashAdjustmentInput, userId: string): Promise<{ id: string }> {
    const company = this.tenant.requireCompanyId();
    const adjDate = dto.date ?? new Date();
    await this.closing.assertOpen(adjDate);
    const created = await this.prisma.cashAdjustment.create({
      data: { companyId: company, adjDate, amount: BigInt(dto.amount), notes: dto.notes, createdById: userId },
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'CashAdjustment', entityId: created.id, summary: `Cash adjustment ${dto.amount >= 0 ? '+' : ''}${dto.amount}` });
    return { id: created.id };
  }

  /** All cash-affecting movements within a single day, most-recent last. */
  private async dayRows(start: Date, end: Date): Promise<CashBookRow[]> {
    const win = { gte: start, lt: end };
    const [income, expenses, bank, payments, adjustments] = await Promise.all([
      this.prisma.income.findMany({ where: { paymentMethod: 'CASH', incomeDate: win }, select: { incomeNumber: true, incomeDate: true, amount: true, gstAmount: true, source: true } }),
      this.prisma.expense.findMany({ where: { paymentMethod: 'CASH', status: 'APPROVED', expenseDate: win }, select: { expenseNumber: true, expenseDate: true, amount: true, gstAmount: true, category: { select: { name: true } } } }),
      this.prisma.bankTransaction.findMany({ where: { type: { in: ['DEPOSIT', 'WITHDRAWAL'] }, txnDate: win }, select: { txnNumber: true, txnDate: true, type: true, amount: true } }),
      this.prisma.payment.findMany({ where: { mode: 'CASH', paidAt: win }, select: { receiptNumber: true, paidAt: true, amount: true, context: true } }),
      this.prisma.cashAdjustment.findMany({ where: { adjDate: win }, select: { adjDate: true, amount: true, notes: true } }),
    ]);
    const rows: CashBookRow[] = [];
    for (const i of income) rows.push({ at: i.incomeDate.toISOString(), kind: 'INCOME', label: `${i.incomeNumber} · ${i.source}`, inAmount: String(i.amount + i.gstAmount), outAmount: '0' });
    for (const e of expenses) rows.push({ at: e.expenseDate.toISOString(), kind: 'EXPENSE', label: `${e.expenseNumber} · ${e.category.name}`, inAmount: '0', outAmount: String(e.amount + e.gstAmount) });
    for (const b of bank) rows.push({ at: b.txnDate.toISOString(), kind: 'BANK', label: `${b.txnNumber} · ${b.type}`, inAmount: b.type === 'WITHDRAWAL' ? String(b.amount) : '0', outAmount: b.type === 'DEPOSIT' ? String(b.amount) : '0' });
    for (const p of payments) rows.push({ at: p.paidAt.toISOString(), kind: p.context === 'SERVICE' ? 'SERVICE' : 'SALES', label: `${p.receiptNumber ?? 'Receipt'} · ${p.context}`, inAmount: String(p.amount), outAmount: '0' });
    for (const a of adjustments) rows.push({ at: a.adjDate.toISOString(), kind: 'ADJUSTMENT', label: a.notes, inAmount: a.amount >= 0n ? String(a.amount) : '0', outAmount: a.amount < 0n ? String(-a.amount) : '0' });
    return rows.sort((a, b) => a.at.localeCompare(b.at));
  }
}
