import { z } from 'zod';
import {
  BANK_DIRECTIONS,
  BANK_RECON_STATUSES,
  BANK_TXN_TYPES,
  EXPENSE_STATUSES,
  FINANCE_PAY_METHODS,
  INCOME_SOURCES,
  VENDOR_STATUSES,
  type BankDirection,
  type BankReconStatus,
  type BankTxnType,
  type ExpenseAttachmentType,
  type ExpenseStatus,
  type FinancePayMethod,
  type IncomeSource,
  type VendorStatus,
} from './enums';

const paise = z.coerce.number().int().min(0);
const payMethodTuple = FINANCE_PAY_METHODS as [FinancePayMethod, ...FinancePayMethod[]];
const expenseStatusTuple = EXPENSE_STATUSES as [ExpenseStatus, ...ExpenseStatus[]];
const incomeSourceTuple = INCOME_SOURCES as [IncomeSource, ...IncomeSource[]];
const vendorStatusTuple = VENDOR_STATUSES as [VendorStatus, ...VendorStatus[]];
const bankTypeTuple = BANK_TXN_TYPES as [BankTxnType, ...BankTxnType[]];
const bankDirTuple = BANK_DIRECTIONS as [BankDirection, ...BankDirection[]];
const bankReconTuple = BANK_RECON_STATUSES as [BankReconStatus, ...BankReconStatus[]];

/* ------------------------------------------------------------------ *
 * DTOs
 * ------------------------------------------------------------------ */

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  isSystem: boolean;
  active: boolean;
  expenseCount: number;
}

export interface VendorDto {
  id: string;
  vendorNumber: string;
  name: string;
  mobile: string | null;
  email: string | null;
  gstNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  status: VendorStatus;
  outstanding: string;
  totalPurchases: string;
  createdAt: string;
}

export interface VendorLedgerRow {
  id: string;
  date: string;
  expenseNumber: string;
  category: string;
  description: string | null;
  amount: string;
  paid: boolean;
}

export interface VendorLedgerDto {
  vendor: VendorDto;
  rows: VendorLedgerRow[];
}

export interface ExpenseAttachmentDto {
  id: string;
  type: ExpenseAttachmentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface ExpenseDto {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  categoryId: string;
  category: string;
  vendorId: string | null;
  vendorName: string | null;
  amount: string;
  gstAmount: string;
  total: string;
  paymentMethod: FinancePayMethod;
  referenceNumber: string | null;
  description: string | null;
  status: ExpenseStatus;
  paid: boolean;
  dueDate: string | null;
  attachments: ExpenseAttachmentDto[];
  createdAt: string;
}

export interface IncomeDto {
  id: string;
  incomeNumber: string;
  incomeDate: string;
  source: IncomeSource;
  amount: string;
  gstAmount: string;
  total: string;
  paymentMethod: FinancePayMethod;
  referenceNumber: string | null;
  description: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
}

export interface BankTransactionDto {
  id: string;
  txnNumber: string;
  txnDate: string;
  type: BankTxnType;
  direction: BankDirection;
  amount: string;
  bankName: string | null;
  reference: string | null;
  notes: string | null;
  reconStatus: BankReconStatus;
  createdAt: string;
}

export interface CashBookRow {
  at: string;
  kind: 'INCOME' | 'EXPENSE' | 'BANK' | 'ADJUSTMENT' | 'SALES' | 'SERVICE' | 'REFUND';
  label: string;
  inAmount: string;
  outAmount: string;
}

export interface CashBookDto {
  date: string;
  opening: string;
  cashIn: string;
  cashOut: string;
  closing: string;
  rows: CashBookRow[];
}

export interface ProfitLossLine {
  label: string;
  amount: string;
}
export interface ProfitLossDto {
  range: { from: string; to: string };
  income: ProfitLossLine[];
  expenses: ProfitLossLine[];
  totalIncome: string;
  totalExpense: string;
  costOfGoods: string;
  grossProfit: string;
  netProfit: string;
}

export interface FinanceDashboardDto {
  todayCollection: string;
  todayExpense: string;
  cashInHand: string;
  bankBalance: string;
  monthProfit: string;
  monthExpense: string;
  pendingVendorPayments: string;
  upcomingPayments: number;
  monthlyExpenses: { month: string; label: string; amount: string }[];
  incomeVsExpense: { month: string; label: string; income: string; expense: string }[];
  categoryBreakdown: { name: string; amount: string }[];
  topVendors: { name: string; amount: string }[];
}

/* ------------------------------------------------------------------ *
 * Input schemas
 * ------------------------------------------------------------------ */

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  active: z.boolean().optional(),
});
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;

const contactShape = {
  mobile: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal('')),
  gstNumber: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
};

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(120),
  ...contactShape,
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(vendorStatusTuple).optional(),
  ...contactShape,
});
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(vendorStatusTuple).optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export const createExpenseSchema = z.object({
  expenseDate: z.coerce.date().optional(),
  categoryId: z.string().uuid(),
  vendorId: z.string().uuid().optional(),
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  gstAmount: paise.default(0),
  paymentMethod: z.enum(payMethodTuple).default('CASH'),
  referenceNumber: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  /** Initial approval state — defaults to APPROVED (owner quick-entry); use DRAFT/PENDING for the submit workflow. */
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED'] as const).optional(),
  paid: z.boolean().default(true),
  dueDate: z.coerce.date().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object({
  expenseDate: z.coerce.date().optional(),
  categoryId: z.string().uuid().optional(),
  vendorId: z.string().uuid().nullish(),
  amount: paise.optional(),
  gstAmount: paise.optional(),
  paymentMethod: z.enum(payMethodTuple).optional(),
  referenceNumber: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(500).nullish(),
  dueDate: z.coerce.date().nullish(),
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(expenseStatusTuple).optional(),
  categoryId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  paymentMethod: z.enum(payMethodTuple).optional(),
  unpaidOnly: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const setExpenseStatusSchema = z.object({
  status: z.enum(expenseStatusTuple),
  note: z.string().trim().max(300).optional(),
});
export type SetExpenseStatusInput = z.infer<typeof setExpenseStatusSchema>;

export const createIncomeSchema = z.object({
  incomeDate: z.coerce.date().optional(),
  source: z.enum(incomeSourceTuple),
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  gstAmount: paise.default(0),
  paymentMethod: z.enum(payMethodTuple).default('CASH'),
  referenceNumber: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  customerId: z.string().uuid().optional(),
});
export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;

export const listIncomeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum(incomeSourceTuple).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListIncomeQuery = z.infer<typeof listIncomeQuerySchema>;

export const createBankTransactionSchema = z.object({
  txnDate: z.coerce.date().optional(),
  type: z.enum(bankTypeTuple),
  direction: z.enum(bankDirTuple).optional(),
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  bankName: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
});
export type CreateBankTransactionInput = z.infer<typeof createBankTransactionSchema>;

export const listBankQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(bankTypeTuple).optional(),
  direction: z.enum(bankDirTuple).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListBankQuery = z.infer<typeof listBankQuerySchema>;

export const cashBookQuerySchema = z.object({
  date: z.coerce.date().optional(),
});
export type CashBookQuery = z.infer<typeof cashBookQuerySchema>;

export const createCashAdjustmentSchema = z.object({
  date: z.coerce.date().optional(),
  amount: z.coerce.number().int(), // signed paise (+ cash in, − cash out)
  notes: z.string().trim().min(1, 'A note is required').max(300),
});
export type CreateCashAdjustmentInput = z.infer<typeof createCashAdjustmentSchema>;

export const pnlQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type PnlQuery = z.infer<typeof pnlQuerySchema>;

/* ------------------------------------------------------------------ *
 * Module 9.1 — attachments, approval, recurring, GST, closing, recon
 * ------------------------------------------------------------------ */

export const submitExpenseSchema = z.object({}).optional();

export const reconcileBankSchema = z.object({
  reconStatus: z.enum(bankReconTuple),
});
export type ReconcileBankInput = z.infer<typeof reconcileBankSchema>;

export interface RecurringExpenseDto {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  vendorId: string | null;
  vendorName: string | null;
  amount: string;
  gstAmount: string;
  total: string;
  paymentMethod: FinancePayMethod;
  dayOfMonth: number;
  description: string | null;
  active: boolean;
  lastRun: string | null;
  createdAt: string;
}

export const createRecurringExpenseSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  categoryId: z.string().uuid(),
  vendorId: z.string().uuid().optional(),
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  gstAmount: paise.default(0),
  paymentMethod: z.enum(payMethodTuple).default('BANK_TRANSFER'),
  dayOfMonth: z.coerce.number().int().min(1).max(28).default(1),
  description: z.string().trim().max(500).optional(),
});
export type CreateRecurringExpenseInput = z.infer<typeof createRecurringExpenseSchema>;

export const updateRecurringExpenseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().uuid().optional(),
  vendorId: z.string().uuid().nullish(),
  amount: paise.optional(),
  gstAmount: paise.optional(),
  paymentMethod: z.enum(payMethodTuple).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
  description: z.string().trim().max(500).nullish(),
  active: z.boolean().optional(),
});
export type UpdateRecurringExpenseInput = z.infer<typeof updateRecurringExpenseSchema>;

export interface MonthlyClosingDto {
  id: string;
  year: number;
  month: number;
  label: string;
  notes: string | null;
  closedAt: string;
}

export const closeMonthSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  notes: z.string().trim().max(300).optional(),
});
export type CloseMonthInput = z.infer<typeof closeMonthSchema>;

export interface GstSummaryDto {
  range: { from: string; to: string };
  collected: string;
  paid: string;
  difference: string;
  monthly: { month: string; label: string; collected: string; paid: string; difference: string }[];
}

export const gstSummaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type GstSummaryQuery = z.infer<typeof gstSummaryQuerySchema>;
