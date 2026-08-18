import type { BankDirection, BankTxnType } from '@azad/shared';

/** Bank transaction types that increase the bank balance when direction is unspecified. */
const CREDIT_DEFAULT: BankTxnType[] = ['DEPOSIT'];
const DEBIT_DEFAULT: BankTxnType[] = ['WITHDRAWAL'];

/**
 * Resolve the balance direction for a bank transaction. DEPOSIT is always a credit
 * and WITHDRAWAL always a debit; NEFT/RTGS/IMPS/CHEQUE/UPI can be either, so the
 * caller's explicit direction wins (defaulting to DEBIT — money leaving the bank).
 */
export function resolveBankDirection(type: BankTxnType, explicit?: BankDirection): BankDirection {
  if (CREDIT_DEFAULT.includes(type)) return 'CREDIT';
  if (DEBIT_DEFAULT.includes(type)) return 'DEBIT';
  return explicit ?? 'DEBIT';
}

/**
 * How a bank transaction moves cash-in-hand: a DEPOSIT takes cash out of the drawer
 * into the bank; a WITHDRAWAL brings bank money into the drawer. Other electronic
 * transfers don't touch physical cash.
 */
export function bankCashEffect(type: BankTxnType): 'CASH_IN' | 'CASH_OUT' | 'NONE' {
  if (type === 'WITHDRAWAL') return 'CASH_IN';
  if (type === 'DEPOSIT') return 'CASH_OUT';
  return 'NONE';
}

/** [start, end) of a calendar day. */
export function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Financial-year window containing `on`, given the FY start month (1–12). */
export function financialYear(on: Date, startMonth: number): { from: Date; to: Date } {
  const m = startMonth - 1;
  const year = on.getMonth() >= m ? on.getFullYear() : on.getFullYear() - 1;
  return { from: new Date(year, m, 1), to: new Date(year + 1, m, 1) };
}

/** Sum a list of bigints. */
export function sumBig(values: (bigint | null | undefined)[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + (v ?? 0n), 0n);
}
