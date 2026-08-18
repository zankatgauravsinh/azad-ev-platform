import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListBankQuery, ListExpensesQuery, ListIncomeQuery, ListVendorsQuery } from '@azad/shared';
import { bankApi, expensesApi, financeApi, incomeApi, vendorsApi } from './api';

const keys = {
  all: ['finance'] as const,
  dashboard: ['finance', 'dashboard'] as const,
  categories: ['finance', 'categories'] as const,
  cashBook: (date?: string) => ['finance', 'cash-book', date ?? 'today'] as const,
  pnl: (r: { from?: string; to?: string }) => ['finance', 'pnl', r] as const,
  expenses: (q: Partial<ListExpensesQuery>) => ['finance', 'expenses', q] as const,
  vendors: (q: Partial<ListVendorsQuery>) => ['finance', 'vendors', q] as const,
  vendorLedger: (id: string) => ['finance', 'vendor-ledger', id] as const,
  income: (q: Partial<ListIncomeQuery>) => ['finance', 'income', q] as const,
  bank: (q: Partial<ListBankQuery>) => ['finance', 'bank', q] as const,
};

export const useFinanceDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: financeApi.dashboard });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: financeApi.categories });
export const useCashBook = (date?: string) => useQuery({ queryKey: keys.cashBook(date), queryFn: () => financeApi.cashBook(date) });
export const usePnl = (r: { from?: string; to?: string }) => useQuery({ queryKey: keys.pnl(r), queryFn: () => financeApi.pnl(r) });
export const useExpenses = (q: Partial<ListExpensesQuery>) => useQuery({ queryKey: keys.expenses(q), queryFn: () => expensesApi.list(q) });
export const useVendors = (q: Partial<ListVendorsQuery>) => useQuery({ queryKey: keys.vendors(q), queryFn: () => vendorsApi.list(q) });
export const useVendorLedger = (id: string | undefined) => useQuery({ queryKey: keys.vendorLedger(id ?? ''), queryFn: () => vendorsApi.ledger(id as string), enabled: Boolean(id) });
export const useIncome = (q: Partial<ListIncomeQuery>) => useQuery({ queryKey: keys.income(q), queryFn: () => incomeApi.list(q) });
export const useBank = (q: Partial<ListBankQuery>) => useQuery({ queryKey: keys.bank(q), queryFn: () => bankApi.list(q) });
export const useGstSummary = (r: { from?: string; to?: string }) => useQuery({ queryKey: ['finance', 'gst', r], queryFn: () => financeApi.gstSummary(r) });
export const useRecurring = () => useQuery({ queryKey: ['finance', 'recurring'], queryFn: financeApi.recurring });
export const useClosings = () => useQuery({ queryKey: ['finance', 'closings'], queryFn: financeApi.closings });
export const useExpense = (id: string | undefined) => useQuery({ queryKey: ['finance', 'expense', id ?? ''], queryFn: () => expensesApi.get(id as string), enabled: Boolean(id) });

export function useFinanceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.all });
  const opts = { onSuccess: invalidate };
  return {
    invalidate,
    createExpense: useMutation({ mutationFn: expensesApi.create, ...opts }),
    setExpenseStatus: useMutation({ mutationFn: (v: { id: string; status: string }) => expensesApi.setStatus(v.id, v.status), ...opts }),
    submitExpense: useMutation({ mutationFn: expensesApi.submit, ...opts }),
    settleExpense: useMutation({ mutationFn: expensesApi.settle, ...opts }),
    removeExpense: useMutation({ mutationFn: expensesApi.remove, ...opts }),
    addAttachment: useMutation({ mutationFn: (v: { id: string; file: File; type: string }) => expensesApi.addAttachment(v.id, v.file, v.type), ...opts }),
    removeAttachment: useMutation({ mutationFn: (v: { id: string; attachmentId: string }) => expensesApi.removeAttachment(v.id, v.attachmentId), ...opts }),
    reconcileBank: useMutation({ mutationFn: (v: { id: string; reconStatus: string }) => bankApi.reconcile(v.id, v.reconStatus), ...opts }),
    createRecurring: useMutation({ mutationFn: financeApi.createRecurring, ...opts }),
    removeRecurring: useMutation({ mutationFn: financeApi.removeRecurring, ...opts }),
    runRecurring: useMutation({ mutationFn: financeApi.runRecurring, ...opts }),
    closeMonth: useMutation({ mutationFn: financeApi.closeMonth, ...opts }),
    reopenMonth: useMutation({ mutationFn: financeApi.reopenMonth, ...opts }),
    createVendor: useMutation({ mutationFn: vendorsApi.create, ...opts }),
    createIncome: useMutation({ mutationFn: incomeApi.create, ...opts }),
    createBank: useMutation({ mutationFn: bankApi.create, ...opts }),
    addAdjustment: useMutation({ mutationFn: financeApi.addAdjustment, ...opts }),
    createCategory: useMutation({ mutationFn: financeApi.createCategory, ...opts }),
  };
}
