import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangeUnitStatusInput,
  CreateUnitInput,
  ListUnitsQuery,
  UpdateUnitInput,
} from '@azad/shared';
import { inventoryApi } from './api';

const keys = {
  all: ['inventory'] as const,
  list: (query: Partial<ListUnitsQuery>) => ['inventory', 'list', query] as const,
  stats: () => ['inventory', 'stats'] as const,
  dashboard: () => ['inventory', 'dashboard'] as const,
  detail: (id: string) => ['inventory', 'unit', id] as const,
  models: () => ['inventory', 'models'] as const,
};

export function useInventoryList(query: Partial<ListUnitsQuery>) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => inventoryApi.list(query),
  });
}

export function useInventoryDashboard(enabled = true) {
  return useQuery({ queryKey: keys.dashboard(), queryFn: inventoryApi.dashboard, enabled });
}

export function useUnit(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: () => inventoryApi.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useModels() {
  return useQuery({ queryKey: keys.models(), queryFn: inventoryApi.models });
}

export function useVariants(modelId?: string) {
  return useQuery({ queryKey: ['inventory', 'variants', modelId ?? 'all'], queryFn: () => inventoryApi.variants(modelId) });
}

export function useAvailableUnits() {
  return useQuery({
    queryKey: ['inventory', 'available-units'],
    queryFn: () => inventoryApi.list({ status: 'AVAILABLE', pageSize: 100 }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}

export function useCreateUnit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateUnitInput) => inventoryApi.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateUnit(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: UpdateUnitInput) => inventoryApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteUnit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => inventoryApi.remove(id),
    onSuccess: invalidate,
  });
}

export function useChangeStatus(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ChangeUnitStatusInput) => inventoryApi.changeStatus(id, input),
    onSuccess: invalidate,
  });
}

export function useImportCsv() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => inventoryApi.importCsv(file),
    onSuccess: invalidate,
  });
}
