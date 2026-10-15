import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListRtoInvoicesQuery } from '@azad/shared';
import { rtoApi } from './api';

export const rtoKeys = {
  all: ['rto-invoices'] as const,
  list: (q: Partial<ListRtoInvoicesQuery>) => ['rto-invoices', 'list', q] as const,
  detail: (id: string) => ['rto-invoices', 'detail', id] as const,
};

export const useRtoInvoices = (q: Partial<ListRtoInvoicesQuery>, enabled = true) => useQuery({ queryKey: rtoKeys.list(q), queryFn: () => rtoApi.list(q), enabled });
export const useRtoInvoice = (id: string | null | undefined) => useQuery({ queryKey: rtoKeys.detail(id ?? ''), queryFn: () => rtoApi.detail(id as string), enabled: Boolean(id) });

/** Generating or revising changes the RTO list and the booking page that shows the RTO invoice. */
export function useRtoMutations() {
  const qc = useQueryClient();
  const onSuccess = async (): Promise<void> => {
    await Promise.all([qc.invalidateQueries({ queryKey: rtoKeys.all }), qc.invalidateQueries({ queryKey: ['bookings'] }), qc.invalidateQueries({ queryKey: ['sales'] })]);
  };
  return {
    generate: useMutation({ mutationFn: rtoApi.generate, onSuccess }),
    revise: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof rtoApi.revise>[1] }) => rtoApi.revise(v.id, v.body), onSuccess }),
  };
}
