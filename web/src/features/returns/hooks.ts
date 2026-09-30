import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListReturnsQuery } from '@azad/shared';
import { returnsApi } from './api';

const keys = {
  all: ['returns'] as const,
  list: (q: Partial<ListReturnsQuery>) => ['returns', 'list', q] as const,
  detail: (id: string) => ['returns', 'detail', id] as const,
};

export const useReturns = (q: Partial<ListReturnsQuery>) => useQuery({ queryKey: keys.list(q), queryFn: () => returnsApi.list(q) });
export const useReturn = (id: string | undefined) =>
  useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => returnsApi.detail(id as string), enabled: Boolean(id) });

export function useReturnMutations() {
  const qc = useQueryClient();
  const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }) };
  return {
    request: useMutation({ mutationFn: (body: Parameters<typeof returnsApi.request>[0]) => returnsApi.request(body), ...opts }),
    inspect: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof returnsApi.inspect>[1] }) => returnsApi.inspect(v.id, v.body), ...opts }),
    approve: useMutation({ mutationFn: (id: string) => returnsApi.approve(id), ...opts }),
    reject: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof returnsApi.reject>[1] }) => returnsApi.reject(v.id, v.body), ...opts }),
    cancel: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof returnsApi.cancel>[1] }) => returnsApi.cancel(v.id, v.body), ...opts }),
    complete: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof returnsApi.complete>[1] }) => returnsApi.complete(v.id, v.body), ...opts }),
  };
}
