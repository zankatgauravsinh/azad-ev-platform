import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplyVendorPaymentInput, CancelVendorPaymentInput, ListVendorBillsQuery } from '@azad/shared';
import { vendorPayablesApi, type PaymentListParams } from './payables-api';

export const payablesKeys = {
  all: ['vendor-payables'] as const,
  overview: (id: string) => ['vendor-payables', 'overview', id] as const,
  bills: (id: string, q: Partial<ListVendorBillsQuery>) => ['vendor-payables', 'bills', id, q] as const,
  statement: (id: string, r: { from?: string; to?: string }) => ['vendor-payables', 'statement', id, r] as const,
  payments: (q: PaymentListParams) => ['vendor-payables', 'payments', q] as const,
};

export const useVendorOverview = (id: string | undefined) =>
  useQuery({ queryKey: payablesKeys.overview(id ?? ''), queryFn: () => vendorPayablesApi.overview(id as string), enabled: Boolean(id) });
export const useVendorBills = (id: string | undefined, q: Partial<ListVendorBillsQuery> = {}, enabled = true) =>
  useQuery({ queryKey: payablesKeys.bills(id ?? '', q), queryFn: () => vendorPayablesApi.bills(id as string, q), enabled: Boolean(id) && enabled });
export const useVendorStatement = (id: string | undefined, r: { from?: string; to?: string }) =>
  useQuery({ queryKey: payablesKeys.statement(id ?? '', r), queryFn: () => vendorPayablesApi.statement(id as string, r), enabled: Boolean(id) });
export const useVendorPayments = (q: PaymentListParams, enabled = true) =>
  useQuery({ queryKey: payablesKeys.payments(q), queryFn: () => vendorPayablesApi.payments(q), enabled });

/**
 * Paying a vendor changes its bills, totals and statement, the scooters and accessory bills it settles, the cash
 * book and P&L screens, and any purchase order it was an advance against — all of those reload.
 */
export function useVendorPaymentMutations() {
  const qc = useQueryClient();
  const onSuccess = async (): Promise<void> => {
    await Promise.all(
      [payablesKeys.all, ['finance'], ['inventory'], ['accessory-purchases'], ['purchase-orders']].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
  };
  return {
    pay: useMutation({ mutationFn: vendorPayablesApi.pay, onSuccess }),
    apply: useMutation({ mutationFn: (v: { id: string; body: ApplyVendorPaymentInput }) => vendorPayablesApi.apply(v.id, v.body), onSuccess }),
    cancel: useMutation({ mutationFn: (v: { id: string; body: CancelVendorPaymentInput }) => vendorPayablesApi.cancel(v.id, v.body), onSuccess }),
  };
}
