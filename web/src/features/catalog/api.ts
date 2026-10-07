import type {
  CatalogModelDto,
  CatalogStatusFilter,
  CatalogVariantDto,
  CreateCatalogModelInput,
  CreateCatalogVariantInput,
  UpdateCatalogModelInput,
  UpdateCatalogVariantInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface ModelsQuery {
  q?: string;
  status: CatalogStatusFilter;
}

/** The curated catalogue (M2 API). GST classification is read here and written only on the GST page. */
export const catalogApi = {
  listModels: async (query: ModelsQuery): Promise<CatalogModelDto[]> =>
    (await apiClient.get<CatalogModelDto[]>('/inventory/models', { params: { status: query.status, ...(query.q ? { q: query.q } : {}) } })).data,
  getModel: async (id: string): Promise<CatalogModelDto> => (await apiClient.get<CatalogModelDto>(`/inventory/models/${id}`)).data,
  createModel: async (input: CreateCatalogModelInput): Promise<CatalogModelDto> => (await apiClient.post<CatalogModelDto>('/inventory/models', input)).data,
  updateModel: async (id: string, input: UpdateCatalogModelInput): Promise<CatalogModelDto> => (await apiClient.patch<CatalogModelDto>(`/inventory/models/${id}`, input)).data,
  setModelActive: async (id: string, isActive: boolean): Promise<CatalogModelDto> => (await apiClient.patch<CatalogModelDto>(`/inventory/models/${id}/active`, { isActive })).data,

  listVariants: async (modelId: string, status: CatalogStatusFilter): Promise<CatalogVariantDto[]> =>
    (await apiClient.get<CatalogVariantDto[]>('/inventory/variants', { params: { modelId, status } })).data,
  createVariant: async (modelId: string, input: CreateCatalogVariantInput): Promise<CatalogVariantDto> =>
    (await apiClient.post<CatalogVariantDto>(`/inventory/models/${modelId}/variants`, input)).data,
  updateVariant: async (id: string, input: UpdateCatalogVariantInput): Promise<CatalogVariantDto> => (await apiClient.patch<CatalogVariantDto>(`/inventory/variants/${id}`, input)).data,
  setVariantActive: async (id: string, isActive: boolean): Promise<CatalogVariantDto> => (await apiClient.patch<CatalogVariantDto>(`/inventory/variants/${id}/active`, { isActive })).data,
};
