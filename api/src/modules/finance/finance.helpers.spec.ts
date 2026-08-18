import { bankCashEffect, financialYear, resolveBankDirection, sumBig } from './finance.helpers';

describe('finance.helpers', () => {
  describe('resolveBankDirection', () => {
    it('forces DEPOSIT→CREDIT and WITHDRAWAL→DEBIT regardless of hint', () => {
      expect(resolveBankDirection('DEPOSIT', 'DEBIT')).toBe('CREDIT');
      expect(resolveBankDirection('WITHDRAWAL', 'CREDIT')).toBe('DEBIT');
    });
    it('honours the explicit direction for transfers (default DEBIT)', () => {
      expect(resolveBankDirection('NEFT', 'CREDIT')).toBe('CREDIT');
      expect(resolveBankDirection('UPI')).toBe('DEBIT');
    });
  });

  describe('bankCashEffect', () => {
    it('maps deposit/withdrawal to the cash drawer', () => {
      expect(bankCashEffect('WITHDRAWAL')).toBe('CASH_IN');
      expect(bankCashEffect('DEPOSIT')).toBe('CASH_OUT');
      expect(bankCashEffect('NEFT')).toBe('NONE');
    });
  });

  describe('financialYear', () => {
    // Compare local calendar parts — the window is built from local dates, not UTC.
    const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    it('April-start FY: a March date belongs to the previous FY', () => {
      const fy = financialYear(new Date(2026, 2, 15), 4);
      expect(ymd(fy.from)).toBe('2025-04-01');
      expect(ymd(fy.to)).toBe('2026-04-01');
    });
    it('April-start FY: an April date starts a new FY', () => {
      const fy = financialYear(new Date(2026, 3, 2), 4);
      expect(ymd(fy.from)).toBe('2026-04-01');
    });
  });

  describe('sumBig', () => {
    it('sums bigints, treating null/undefined as zero', () => {
      expect(sumBig([100n, null, 50n, undefined])).toBe(150n);
    });
  });
});
