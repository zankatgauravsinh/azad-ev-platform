import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddAccessorySalePaymentInput, CancelAccessorySaleInput, ListAccessorySalesQuery } from '@azad/shared';
import { accessorySalesApi } from './api';

const keys = {
  all: ['accessory-sales'] as const,
  list: (q: Partial<ListAccessorySalesQuery>) => ['accessory-sales', 'list', q] as const,
  detail: (id: string) => ['accessory-sales', 'detail', id] as const,
  defaults: (customerId?: string) => ['accessory-sales', 'defaults', customerId ?? ''] as const,
};

export const useAccessorySales = (q: Partial<ListAccessorySalesQuery>, enabled = true) => useQuery({ queryKey: keys.list(q), queryFn: () => accessorySalesApi.list(q), enabled });
export const useAccessorySale = (id: string | null) => useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => accessorySalesApi.get(id as string), enabled: Boolean(id) });
export const useAccessorySaleDefaults = (customerId: string | undefined, enabled: boolean) => useQuery({ queryKey: keys.defaults(customerId), queryFn: () => accessorySalesApi.defaults(customerId), enabled });

export function useAccessorySaleMutations() {
  const qc = useQueryClient();
  // A sale moves stock (accessories) and money (finance, customer payments).
  const onSuccess = () => Promise.all(['accessory-sales', 'accessories', 'finance', 'customers'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    create: useMutation({ mutationFn: accessorySalesApi.create, onSuccess }),
    addPayment: useMutation({ mutationFn: (v: { id: string; body: AddAccessorySalePaymentInput }) => accessorySalesApi.addPayment(v.id, v.body), onSuccess }),
    cancel: useMutation({ mutationFn: (v: { id: string; body: CancelAccessorySaleInput }) => accessorySalesApi.cancel(v.id, v.body), onSuccess }),
  };
}
