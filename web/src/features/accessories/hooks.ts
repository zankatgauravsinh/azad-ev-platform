import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpeningStockInput, StockAdjustmentInput, UpdateAccessoryInput } from '@azad/shared';
import { accessoriesApi, type AccessoryFilters } from './api';

const keys = {
  all: ['accessories'] as const,
  list: (f: AccessoryFilters) => ['accessories', 'list', f] as const,
  categories: ['accessories', 'categories'] as const,
  detail: (id: string) => ['accessories', 'detail', id] as const,
};

export const useAccessoryList = (f: AccessoryFilters) => useQuery({ queryKey: keys.list(f), queryFn: () => accessoriesApi.list(f) });
export const useAccessoryCategories = () => useQuery({ queryKey: keys.categories, queryFn: accessoriesApi.categories, staleTime: 60_000 });
export const useAccessory = (id: string | null) => useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => accessoriesApi.get(id as string), enabled: Boolean(id) });

export function useAccessoryMutations() {
  const qc = useQueryClient();
  // The booking / quotation pickers and the GST page read the same catalogue under ['sales', 'accessories'].
  const onSuccess = () => Promise.all([qc.invalidateQueries({ queryKey: keys.all }), qc.invalidateQueries({ queryKey: ['sales', 'accessories'] })]);
  return {
    create: useMutation({ mutationFn: accessoriesApi.create, onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; body: UpdateAccessoryInput }) => accessoriesApi.update(v.id, v.body), onSuccess }),
    setActive: useMutation({ mutationFn: (v: { id: string; active: boolean }) => accessoriesApi.setActive(v.id, v.active), onSuccess }),
    openingStock: useMutation({ mutationFn: (v: { id: string; body: OpeningStockInput }) => accessoriesApi.openingStock(v.id, v.body), onSuccess }),
    adjust: useMutation({ mutationFn: (v: { id: string; body: StockAdjustmentInput }) => accessoriesApi.adjust(v.id, v.body), onSuccess }),
  };
}
