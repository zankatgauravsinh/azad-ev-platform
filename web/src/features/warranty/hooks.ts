import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListAmcQuery, ListClaimsQuery, ListWarrantiesQuery } from '@azad/shared';
import { amcApi, claimsApi, warrantyApi } from './api';

const keys = {
  all: ['warranty'] as const,
  dashboard: ['warranty', 'dashboard'] as const,
  list: (q: Partial<ListWarrantiesQuery>) => ['warranty', 'list', q] as const,
  detail: (id: string) => ['warranty', 'detail', id] as const,
  claims: (q: Partial<ListClaimsQuery>) => ['warranty', 'claims', q] as const,
  amcList: (q: Partial<ListAmcQuery>) => ['warranty', 'amc', q] as const,
  amcDetail: (id: string) => ['warranty', 'amc-detail', id] as const,
};

export const useWarrantyDashboard = (enabled = true) => useQuery({ queryKey: keys.dashboard, queryFn: warrantyApi.dashboard, enabled });
export const useWarranties = (q: Partial<ListWarrantiesQuery>) => useQuery({ queryKey: keys.list(q), queryFn: () => warrantyApi.list(q) });
export const useWarranty = (id: string | undefined) => useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => warrantyApi.get(id as string), enabled: Boolean(id) });
export const useClaims = (q: Partial<ListClaimsQuery>) => useQuery({ queryKey: keys.claims(q), queryFn: () => claimsApi.list(q) });
export const useAmcPlans = (q: Partial<ListAmcQuery>) => useQuery({ queryKey: keys.amcList(q), queryFn: () => amcApi.list(q) });
export const useAmcPlan = (id: string | undefined) => useQuery({ queryKey: keys.amcDetail(id ?? ''), queryFn: () => amcApi.get(id as string), enabled: Boolean(id) });

export function useWarrantyInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}

export function useWarrantyMutations() {
  const invalidate = useWarrantyInvalidate();
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({ mutationFn: warrantyApi.create, ...opts }),
    cancel: useMutation({ mutationFn: warrantyApi.cancel, ...opts }),
    generate: useMutation({ mutationFn: warrantyApi.generate, ...opts }),
    completeFreeService: useMutation({ mutationFn: (v: { id: string; status: string; remarks?: string }) => warrantyApi.completeFreeService(v.id, { status: v.status, remarks: v.remarks }), ...opts }),
    createClaim: useMutation({ mutationFn: claimsApi.create, ...opts }),
    updateClaim: useMutation({ mutationFn: (v: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED'; note?: string }) => claimsApi.updateStatus(v.id, { status: v.status, note: v.note }), ...opts }),
    createAmc: useMutation({ mutationFn: amcApi.create, ...opts }),
    recordVisit: useMutation({ mutationFn: (v: { id: string; workDone: string; partsUsed?: string; amount: number; coveredUnderAmc: boolean }) => amcApi.recordVisit(v.id, { workDone: v.workDone, partsUsed: v.partsUsed, amount: v.amount, coveredUnderAmc: v.coveredUnderAmc }), ...opts }),
  };
}
