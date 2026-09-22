import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListDeliveriesQuery } from '@azad/shared';
import { deliveryApi } from './api';

const keys = {
  all: ['delivery'] as const,
  list: (q: Partial<ListDeliveriesQuery>) => ['delivery', 'list', q] as const,
  dashboard: ['delivery', 'dashboard'] as const,
  detail: (id: string) => ['delivery', 'detail', id] as const,
};

export const useDeliveries = (q: Partial<ListDeliveriesQuery>) => useQuery({ queryKey: keys.list(q), queryFn: () => deliveryApi.list(q) });
export const useDeliveryDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: deliveryApi.dashboard });
export const useDelivery = (id: string | undefined) => useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => deliveryApi.detail(id as string), enabled: Boolean(id) });

export function useDeliveryMutations() {
  const qc = useQueryClient();
  const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }) };
  return {
    schedule: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof deliveryApi.schedule>[1] }) => deliveryApi.schedule(v.id, v.body), ...opts }),
    complete: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof deliveryApi.complete>[1] }) => deliveryApi.complete(v.id, v.body), ...opts }),
    checklist: useMutation({ mutationFn: (v: { id: string; body: Parameters<typeof deliveryApi.checklist>[1] }) => deliveryApi.checklist(v.id, v.body), ...opts }),
    addPhoto: useMutation({ mutationFn: (v: { id: string; file: File; label?: string }) => deliveryApi.addPhoto(v.id, v.file, v.label), ...opts }),
    removePhoto: useMutation({ mutationFn: (v: { id: string; photoId: string }) => deliveryApi.removePhoto(v.id, v.photoId), ...opts }),
    setSignature: useMutation({ mutationFn: (v: { id: string; file: File }) => deliveryApi.setSignature(v.id, v.file), ...opts }),
  };
}
