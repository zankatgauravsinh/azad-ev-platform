import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelAccessoryPurchaseInput, MarkAccessoryPurchasePaidInput } from '@azad/shared';
import { accessoryPurchasesApi, type PurchaseListParams } from './purchases-api';

const keys = {
  list: (q: PurchaseListParams) => ['accessory-purchases', 'list', q] as const,
  detail: (id: string) => ['accessory-purchases', 'detail', id] as const,
  defaults: ['accessory-purchases', 'defaults'] as const,
};

export const useAccessoryPurchases = (q: PurchaseListParams, enabled = true) => useQuery({ queryKey: keys.list(q), queryFn: () => accessoryPurchasesApi.list(q), enabled });
export const useAccessoryPurchase = (id: string | null) => useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => accessoryPurchasesApi.get(id as string), enabled: Boolean(id) });
export const usePurchaseDefaults = (enabled: boolean) => useQuery({ queryKey: keys.defaults, queryFn: accessoryPurchasesApi.defaults, enabled, staleTime: 60_000 });

export function useAccessoryPurchaseMutations() {
  const qc = useQueryClient();
  // A purchase moves stock (accessories) and money (vendor ledger, cash book, GST).
  const onSuccess = () => Promise.all(['accessory-purchases', 'accessories', 'finance'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    create: useMutation({ mutationFn: accessoryPurchasesApi.create, onSuccess }),
    pay: useMutation({ mutationFn: (v: { id: string; body: MarkAccessoryPurchasePaidInput }) => accessoryPurchasesApi.pay(v.id, v.body), onSuccess }),
    cancel: useMutation({ mutationFn: (v: { id: string; body: CancelAccessoryPurchaseInput }) => accessoryPurchasesApi.cancel(v.id, v.body), onSuccess }),
  };
}
