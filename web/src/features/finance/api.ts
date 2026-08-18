import type {
  BankTransactionDto,
  CashBookDto,
  CloseMonthInput,
  CreateBankTransactionInput,
  CreateCashAdjustmentInput,
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  CreateIncomeInput,
  CreateRecurringExpenseInput,
  CreateVendorInput,
  ExpenseCategoryDto,
  ExpenseDto,
  FinanceDashboardDto,
  GstSummaryDto,
  IncomeDto,
  ListBankQuery,
  ListExpensesQuery,
  ListIncomeQuery,
  ListVendorsQuery,
  MonthlyClosingDto,
  Paginated,
  ProfitLossDto,
  RecurringExpenseDto,
  UpdateRecurringExpenseInput,
  UpdateVendorInput,
  VendorDto,
  VendorLedgerDto,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL'));

export const financeApi = {
  dashboard: async (): Promise<FinanceDashboardDto> => (await apiClient.get('/finance/dashboard')).data,
  pnl: async (r?: { from?: string; to?: string }): Promise<ProfitLossDto> => (await apiClient.get('/finance/pnl', { params: clean(r ?? {}) })).data,
  cashBook: async (date?: string): Promise<CashBookDto> => (await apiClient.get('/finance/cash-book', { params: clean({ date }) })).data,
  cashBookPdf: async (date: string): Promise<Blob> => (await apiClient.get('/finance/cash-book/pdf', { params: { date }, responseType: 'blob' })).data,
  addAdjustment: async (body: CreateCashAdjustmentInput): Promise<{ id: string }> => (await apiClient.post('/finance/cash-book/adjustments', body)).data,
  categories: async (): Promise<ExpenseCategoryDto[]> => (await apiClient.get('/finance/categories')).data,
  createCategory: async (body: CreateExpenseCategoryInput): Promise<ExpenseCategoryDto> => (await apiClient.post('/finance/categories', body)).data,
  gstSummary: async (r?: { from?: string; to?: string }): Promise<GstSummaryDto> => (await apiClient.get('/finance/gst-summary', { params: clean(r ?? {}) })).data,
  recurring: async (): Promise<RecurringExpenseDto[]> => (await apiClient.get('/finance/recurring')).data,
  createRecurring: async (body: CreateRecurringExpenseInput): Promise<RecurringExpenseDto> => (await apiClient.post('/finance/recurring', body)).data,
  updateRecurring: async (id: string, body: UpdateRecurringExpenseInput): Promise<RecurringExpenseDto> => (await apiClient.patch(`/finance/recurring/${id}`, body)).data,
  removeRecurring: async (id: string): Promise<void> => { await apiClient.delete(`/finance/recurring/${id}`); },
  runRecurring: async (): Promise<{ created: number }> => (await apiClient.post('/finance/recurring/run')).data,
  closings: async (): Promise<MonthlyClosingDto[]> => (await apiClient.get('/finance/closings')).data,
  closeMonth: async (body: CloseMonthInput): Promise<MonthlyClosingDto> => (await apiClient.post('/finance/closings', body)).data,
  reopenMonth: async (id: string): Promise<void> => { await apiClient.delete(`/finance/closings/${id}`); },
};

export const expensesApi = {
  list: async (q: Partial<ListExpensesQuery>): Promise<Paginated<ExpenseDto>> => (await apiClient.get('/expenses', { params: clean(q) })).data,
  get: async (id: string): Promise<ExpenseDto> => (await apiClient.get(`/expenses/${id}`)).data,
  create: async (body: CreateExpenseInput): Promise<ExpenseDto> => (await apiClient.post('/expenses', body)).data,
  setStatus: async (id: string, status: string): Promise<ExpenseDto> => (await apiClient.patch(`/expenses/${id}/status`, { status })).data,
  submit: async (id: string): Promise<ExpenseDto> => (await apiClient.post(`/expenses/${id}/submit`)).data,
  settle: async (id: string): Promise<ExpenseDto> => (await apiClient.post(`/expenses/${id}/settle`)).data,
  remove: async (id: string): Promise<void> => { await apiClient.delete(`/expenses/${id}`); },
  voucher: async (id: string): Promise<Blob> => (await apiClient.get(`/expenses/${id}/voucher.pdf`, { responseType: 'blob' })).data,
  addAttachment: async (id: string, file: File, type: string): Promise<ExpenseDto> => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    return (await apiClient.post(`/expenses/${id}/attachments`, form)).data;
  },
  removeAttachment: async (id: string, attachmentId: string): Promise<ExpenseDto> => (await apiClient.delete(`/expenses/${id}/attachments/${attachmentId}`)).data,
};

export const vendorsApi = {
  list: async (q: Partial<ListVendorsQuery>): Promise<Paginated<VendorDto>> => (await apiClient.get('/vendors', { params: clean(q) })).data,
  create: async (body: CreateVendorInput): Promise<VendorDto> => (await apiClient.post('/vendors', body)).data,
  update: async (id: string, body: UpdateVendorInput): Promise<VendorDto> => (await apiClient.patch(`/vendors/${id}`, body)).data,
  ledger: async (id: string): Promise<VendorLedgerDto> => (await apiClient.get(`/vendors/${id}/ledger`)).data,
  ledgerPdf: async (id: string): Promise<Blob> => (await apiClient.get(`/vendors/${id}/ledger.pdf`, { responseType: 'blob' })).data,
};

export const incomeApi = {
  list: async (q: Partial<ListIncomeQuery>): Promise<Paginated<IncomeDto>> => (await apiClient.get('/income', { params: clean(q) })).data,
  create: async (body: CreateIncomeInput): Promise<IncomeDto> => (await apiClient.post('/income', body)).data,
  remove: async (id: string): Promise<void> => { await apiClient.delete(`/income/${id}`); },
  receipt: async (id: string): Promise<Blob> => (await apiClient.get(`/income/${id}/receipt.pdf`, { responseType: 'blob' })).data,
};

export const bankApi = {
  list: async (q: Partial<ListBankQuery>): Promise<Paginated<BankTransactionDto>> => (await apiClient.get('/bank-transactions', { params: clean(q) })).data,
  create: async (body: CreateBankTransactionInput): Promise<BankTransactionDto> => (await apiClient.post('/bank-transactions', body)).data,
  reconcile: async (id: string, reconStatus: string): Promise<BankTransactionDto> => (await apiClient.patch(`/bank-transactions/${id}/reconcile`, { reconStatus })).data,
  remove: async (id: string): Promise<void> => { await apiClient.delete(`/bank-transactions/${id}`); },
};
