import type { BankDirection, BankReconStatus, ExpenseStatus, FinancePayMethod, VendorStatus } from '@azad/shared';

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

export const expenseStatusTone: Record<ExpenseStatus, BadgeTone> = {
  DRAFT: 'muted',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

export const reconStatusTone: Record<BankReconStatus, BadgeTone> = {
  PENDING: 'warning',
  CLEARED: 'info',
  RECONCILED: 'success',
};

export const vendorStatusTone: Record<VendorStatus, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'muted',
};

export const bankDirectionTone: Record<BankDirection, BadgeTone> = {
  CREDIT: 'success',
  DEBIT: 'destructive',
};

export const payMethodLabel: Record<FinancePayMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
};
