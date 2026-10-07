import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogStatusFilter, CreateCatalogModelInput, CreateCatalogVariantInput, UpdateCatalogModelInput, UpdateCatalogVariantInput } from '@azad/shared';
import { catalogApi, type ModelsQuery } from './api';

const keys = {
  all: ['catalog'] as const,
  models: (query: ModelsQuery) => ['catalog', 'models', query] as const,
  model: (id: string) => ['catalog', 'model', id] as const,
  variants: (modelId: string, status: CatalogStatusFilter) => ['catalog', 'variants', modelId, status] as const,
};

/** Only runs for an authorised page (`enabled`): nothing is requested a user may not see. */
export const useCatalogModels = (query: ModelsQuery, enabled = true) => useQuery({ queryKey: keys.models(query), queryFn: () => catalogApi.listModels(query), enabled });
export const useCatalogModel = (id: string | null) => useQuery({ queryKey: keys.model(id ?? ''), queryFn: () => catalogApi.getModel(id as string), enabled: Boolean(id) });
/** Variants of one model, fetched only while that model's detail is open. */
export const useCatalogVariants = (modelId: string | null, status: CatalogStatusFilter) =>
  useQuery({ queryKey: keys.variants(modelId ?? '', status), queryFn: () => catalogApi.listVariants(modelId as string, status), enabled: Boolean(modelId) });

export function useCatalogMutations() {
  const qc = useQueryClient();
  // The Add Scooter form and GST product defaults read the same models/variants through the inventory keys.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.all });
    void qc.invalidateQueries({ queryKey: ['inventory', 'models'] });
    void qc.invalidateQueries({ queryKey: ['inventory', 'variants'] });
  };
  const opts = { onSuccess: invalidate };
  return {
    createModel: useMutation({ mutationFn: (input: CreateCatalogModelInput) => catalogApi.createModel(input), ...opts }),
    updateModel: useMutation({ mutationFn: (v: { id: string; input: UpdateCatalogModelInput }) => catalogApi.updateModel(v.id, v.input), ...opts }),
    setModelActive: useMutation({ mutationFn: (v: { id: string; isActive: boolean }) => catalogApi.setModelActive(v.id, v.isActive), ...opts }),
    createVariant: useMutation({ mutationFn: (v: { modelId: string; input: CreateCatalogVariantInput }) => catalogApi.createVariant(v.modelId, v.input), ...opts }),
    updateVariant: useMutation({ mutationFn: (v: { id: string; input: UpdateCatalogVariantInput }) => catalogApi.updateVariant(v.id, v.input), ...opts }),
    setVariantActive: useMutation({ mutationFn: (v: { id: string; isActive: boolean }) => catalogApi.setVariantActive(v.id, v.isActive), ...opts }),
  };
}
