import type {
  CreateTaxClassificationInput,
  CreateTaxRateInput,
  GstReadinessDto,
  ProductTaxClassificationDto,
  TaxComponentMappingDto,
  TaxMappedComponent,
  TaxClassificationDto,
  TaxRateDto,
  UpdateTaxClassificationInput,
  UpdateTaxRateInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

/** GST / Tax management client (Stage A — configuration). companyId is derived by the backend. */
export const taxApi = {
  listClassifications: async (includeInactive = false): Promise<TaxClassificationDto[]> =>
    (await apiClient.get<TaxClassificationDto[]>('/tax/classifications', { params: includeInactive ? { includeInactive: 'true' } : {} })).data,
  createClassification: async (input: CreateTaxClassificationInput): Promise<TaxClassificationDto> =>
    (await apiClient.post<TaxClassificationDto>('/tax/classifications', input)).data,
  updateClassification: async (id: string, input: UpdateTaxClassificationInput): Promise<TaxClassificationDto> =>
    (await apiClient.patch<TaxClassificationDto>(`/tax/classifications/${id}`, input)).data,
  removeClassification: async (id: string): Promise<void> => {
    await apiClient.delete(`/tax/classifications/${id}`);
  },
  addRate: async (classificationId: string, input: CreateTaxRateInput): Promise<TaxRateDto> =>
    (await apiClient.post<TaxRateDto>(`/tax/classifications/${classificationId}/rates`, input)).data,
  updateRate: async (rateId: string, input: UpdateTaxRateInput): Promise<TaxRateDto> =>
    (await apiClient.patch<TaxRateDto>(`/tax/rates/${rateId}`, input)).data,
  removeRate: async (rateId: string): Promise<void> => {
    await apiClient.delete(`/tax/rates/${rateId}`);
  },

  // ── GST configuration (ids travel in the path / body only — never in a query string) ──
  readiness: async (): Promise<GstReadinessDto> => (await apiClient.get<GstReadinessDto>('/tax/readiness')).data,
  componentMappings: async (): Promise<TaxComponentMappingDto[]> => (await apiClient.get<TaxComponentMappingDto[]>('/tax/component-mappings')).data,
  setComponentMapping: async (component: TaxMappedComponent, classificationId: string): Promise<TaxComponentMappingDto> =>
    (await apiClient.put<TaxComponentMappingDto>(`/tax/component-mappings/${component}`, { classificationId })).data,
  clearComponentMapping: async (component: TaxMappedComponent): Promise<TaxComponentMappingDto> =>
    (await apiClient.delete<TaxComponentMappingDto>(`/tax/component-mappings/${component}`)).data,
  setScooterModelClassification: async (modelId: string, taxClassificationId: string | null): Promise<ProductTaxClassificationDto> =>
    (await apiClient.put<ProductTaxClassificationDto>(`/tax/scooter-models/${modelId}/classification`, { taxClassificationId })).data,
  setAccessoryClassification: async (accessoryId: string, taxClassificationId: string | null): Promise<ProductTaxClassificationDto> =>
    (await apiClient.put<ProductTaxClassificationDto>(`/tax/accessories/${accessoryId}/classification`, { taxClassificationId })).data,
};
