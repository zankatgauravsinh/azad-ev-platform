import { formatInr } from '../../common/utils/money';

/**
 * What a quotation or booking looks like to the audit trail — its prices and terms as plain values, so an
 * edit can be recorded as old → new (diffFields) and a new one as its starting values (createdFields).
 */
type Variant = { name: string; colour: string; model?: { name: string } | null } | null | undefined;
type Lines = { qty: number; unitPrice: bigint; accessory?: { name: string } | null }[] | undefined;

export const variantText = (v: Variant): string | null => (v ? [v.model?.name, v.name, v.colour].filter(Boolean).join(' ') : null);
export const accessoriesText = (lines: Lines): string | null =>
  lines && lines.length ? lines.map((l) => `${l.accessory?.name ?? 'Accessory'} × ${l.qty} @ ${formatInr(l.unitPrice)}`).join('; ') : null;

export const QUOTATION_AUDIT_FIELDS = [
  'status', 'variant', 'exShowroom', 'discount', 'exchangeValue', 'rto', 'insurance', 'registration', 'extendedWarranty',
  'accessories', 'accessoriesTotal', 'total', 'financeDownPayment', 'financeLoanAmount', 'financeTenureMonths', 'financeEmi', 'validUntil', 'notes',
] as const;

export function quotationSnapshot(q: {
  status: string; variant?: Variant; exShowroom: bigint; discount: bigint; exchangeValue: bigint; rto: bigint; insurance: bigint; registration: bigint; extendedWarranty: bigint;
  accessories?: Lines; accessoriesTotal: bigint; total: bigint; financeDownPayment: bigint; financeLoanAmount: bigint; financeTenureMonths: number | null; financeEmi: bigint; validUntil: Date | null; notes: string | null;
}): Record<(typeof QUOTATION_AUDIT_FIELDS)[number], unknown> {
  return {
    status: q.status, variant: variantText(q.variant), exShowroom: q.exShowroom, discount: q.discount, exchangeValue: q.exchangeValue, rto: q.rto, insurance: q.insurance,
    registration: q.registration, extendedWarranty: q.extendedWarranty, accessories: accessoriesText(q.accessories), accessoriesTotal: q.accessoriesTotal, total: q.total,
    financeDownPayment: q.financeDownPayment, financeLoanAmount: q.financeLoanAmount, financeTenureMonths: q.financeTenureMonths, financeEmi: q.financeEmi,
    validUntil: q.validUntil, notes: q.notes,
  };
}

/** A booking's price breakup as agreed (frozen once created). */
export function bookingPriceSnapshot(b: {
  exShowroom: bigint; discount: bigint; exchangeValue: bigint; rto: bigint; insuranceCharge: bigint; registration: bigint; extendedWarranty: bigint;
  accessories?: Lines; accessoriesTotal: bigint; taxAmount: bigint; total: bigint;
}): Record<string, unknown> {
  return {
    exShowroom: b.exShowroom, discount: b.discount, exchangeValue: b.exchangeValue, rto: b.rto, insuranceCharge: b.insuranceCharge, registration: b.registration,
    extendedWarranty: b.extendedWarranty, accessories: accessoriesText(b.accessories), accessoriesTotal: b.accessoriesTotal, taxAmount: b.taxAmount, total: b.total,
  };
}

export const FINANCE_AUDIT_FIELDS = ['financeCompany', 'downPayment', 'loanAmount', 'emiAmount', 'tenureMonths', 'interestRate', 'disbursedAmount', 'status'] as const;
export const INSURANCE_AUDIT_FIELDS = ['provider', 'policyNumber', 'premium', 'startDate', 'endDate', 'status'] as const;
