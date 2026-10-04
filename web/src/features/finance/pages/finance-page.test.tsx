import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FinancePage } from './finance-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }), useCan: (p: string) => h.perms.current.has(p) }));

const emptyList = { data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }, isLoading: false, isFetching: false };
const stub = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('../hooks', () => ({
  useFinanceDashboard: (enabled: boolean) => ({ data: enabled ? { todayCollection: 0n, todayExpense: 0n, cashInHand: 0n, bankBalance: 0n, monthProfit: 0n, monthExpense: 0n, pendingVendorPayments: 0n, upcomingPayments: 0, topVendors: [] } : undefined }),
  useExpenses: () => emptyList,
  useIncome: () => emptyList,
  useVendors: () => emptyList,
  useBank: () => emptyList,
  useCashBook: () => ({ data: { opening: 0n, cashIn: 0n, cashOut: 0n, closing: 0n, rows: [] } }),
  usePnl: () => ({ data: undefined }),
  useGstSummary: () => ({ data: undefined }),
  useClosings: () => ({ data: [] }),
  useFinanceMutations: () => ({ settleExpense: stub, setExpenseStatus: stub, submitExpense: stub, reconcileBank: stub, addAdjustment: stub, closeMonth: stub, reopenMonth: stub }),
}));
vi.mock('../components/create-expense-dialog', () => ({ CreateExpenseDialog: () => null }));
vi.mock('../components/create-income-dialog', () => ({ CreateIncomeDialog: () => null }));
vi.mock('../components/create-vendor-dialog', () => ({ CreateVendorDialog: () => null }));
vi.mock('../components/create-bank-dialog', () => ({ CreateBankDialog: () => null }));
vi.mock('../components/recurring-dialog', () => ({ RecurringDialog: () => null }));
vi.mock('../components/vendor-detail-dialog', () => ({ VendorDetailDialog: () => null }));
vi.mock('../components/expense-detail-dialog', () => ({ ExpenseDetailDialog: () => null }));
vi.mock('@/features/reports/api', () => ({ reportsApi: { exportReport: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><FinancePage /></MemoryRouter>); };
const tab = (name: string | RegExp) => screen.queryByRole('tab', { name });
const btn = (name: RegExp) => screen.queryByRole('button', { name });
beforeEach(() => { h.perms.current = new Set(); });

describe('FinancePage — per-module tab visibility', () => {
  it('each tab shows only with its own view permission', () => {
    renderWith(['expenses.view']);
    expect(tab('Expenses')).not.toBeNull();
    expect(tab('Income')).toBeNull();
    expect(tab('Vendors')).toBeNull();
    expect(tab('Bank')).toBeNull();
    expect(tab('Cash Book')).toBeNull(); // finance.view only
  });

  it('finance.view shows Cash Book / P&L / GST / Closing (not expenses/income/vendors/bank)', () => {
    renderWith(['finance.view']);
    expect(tab('Cash Book')).not.toBeNull();
    expect(tab(/P&L/)).not.toBeNull();
    expect(tab('GST')).not.toBeNull();
    expect(tab('Closing')).not.toBeNull();
    expect(tab('Expenses')).toBeNull();
    expect(tab('Bank')).toBeNull();
  });

  it('zero permissions → no finance tabs at all', () => {
    renderWith([]);
    for (const t of ['Expenses', 'Income', 'Vendors', 'Bank', 'Cash Book', 'Closing']) expect(tab(t)).toBeNull();
  });
});

describe('FinancePage — per-module manage independence', () => {
  it('Expenses: expenses.manage → Record expense; recurring stays finance.manage (hidden without it)', () => {
    renderWith(['expenses.view', 'expenses.manage']);
    expect(btn(/Record expense/)).not.toBeNull();
    expect(btn(/Recurring/)).toBeNull(); // needs finance.manage, not expenses.manage
  });

  it('Expenses: expenses.view only → no Record expense', () => {
    renderWith(['expenses.view']);
    expect(btn(/Record expense/)).toBeNull();
  });

  it('Expenses + finance.manage → Recurring appears', () => {
    renderWith(['expenses.view', 'expenses.manage', 'finance.manage']);
    expect(btn(/Recurring/)).not.toBeNull();
  });

  it('Income: income.manage → Record income (default tab = income when only income.view)', () => {
    renderWith(['income.view', 'income.manage']);
    expect(btn(/Record income/)).not.toBeNull();
    renderWith(['income.view']);
    expect(btn(/Record income/)).toBeNull();
  });

  it('Vendors: vendors.manage → New vendor', () => {
    renderWith(['vendors.view', 'vendors.manage']);
    expect(btn(/New vendor/)).not.toBeNull();
    renderWith(['vendors.view']);
    expect(btn(/New vendor/)).toBeNull();
  });

  it('Bank: bank.manage → Record transaction', () => {
    renderWith(['bank.view', 'bank.manage']);
    expect(btn(/Record transaction/)).not.toBeNull();
    renderWith(['bank.view']);
    expect(btn(/Record transaction/)).toBeNull();
  });

  it('Cash Book: finance.manage → Adjustment (finance.view only → none)', () => {
    renderWith(['finance.view', 'finance.manage']);
    expect(btn(/Adjustment/)).not.toBeNull();
    renderWith(['finance.view']);
    expect(btn(/Adjustment/)).toBeNull();
  });

  it('expenses.manage does NOT imply bank/income/vendor/finance management', () => {
    renderWith(['expenses.view', 'expenses.manage']);
    // Only Expenses tab is visible; other modules are not even reachable.
    expect(tab('Bank')).toBeNull();
    expect(tab('Income')).toBeNull();
    expect(tab('Vendors')).toBeNull();
    expect(tab('Cash Book')).toBeNull();
    expect(btn(/Recurring/)).toBeNull();
  });
});
