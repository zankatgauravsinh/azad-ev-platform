import type {
  AmcPlanDetailDto,
  AmcPlanDto,
  CreateAmcInput,
  CreateAmcVisitInput,
  CreateWarrantyClaimInput,
  CreateWarrantyInput,
  ListAmcQuery,
  ListClaimsQuery,
  ListWarrantiesQuery,
  Paginated,
  UpdateClaimStatusInput,
  UpdateWarrantyInput,
  WarrantyClaimDto,
  WarrantyDashboardDto,
  WarrantyDetailDto,
  WarrantyRecordDto,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL'));

export const warrantyApi = {
  dashboard: async (): Promise<WarrantyDashboardDto> => (await apiClient.get('/warranties/dashboard')).data,
  list: async (q: Partial<ListWarrantiesQuery>): Promise<Paginated<WarrantyRecordDto>> => (await apiClient.get('/warranties', { params: clean(q) })).data,
  get: async (id: string): Promise<WarrantyDetailDto> => (await apiClient.get(`/warranties/${id}`)).data,
  create: async (body: CreateWarrantyInput): Promise<WarrantyDetailDto> => (await apiClient.post('/warranties', body)).data,
  update: async (id: string, body: UpdateWarrantyInput): Promise<WarrantyDetailDto> => (await apiClient.patch(`/warranties/${id}`, body)).data,
  cancel: async (id: string): Promise<WarrantyDetailDto> => (await apiClient.post(`/warranties/${id}/cancel`)).data,
  generate: async (): Promise<{ created: number }> => (await apiClient.post('/warranties/generate')).data,
  completeFreeService: async (id: string, body: { status: string; remarks?: string }) => (await apiClient.patch(`/warranties/free-service/${id}`, body)).data,
  certificate: async (id: string): Promise<Blob> => (await apiClient.get(`/warranties/${id}/certificate.pdf`, { responseType: 'blob' })).data,
};

export const claimsApi = {
  list: async (q: Partial<ListClaimsQuery>): Promise<Paginated<WarrantyClaimDto>> => (await apiClient.get('/warranty-claims', { params: clean(q) })).data,
  create: async (body: CreateWarrantyClaimInput): Promise<WarrantyClaimDto> => (await apiClient.post('/warranty-claims', body)).data,
  updateStatus: async (id: string, body: UpdateClaimStatusInput): Promise<WarrantyClaimDto> => (await apiClient.patch(`/warranty-claims/${id}/status`, body)).data,
};

export const amcApi = {
  list: async (q: Partial<ListAmcQuery>): Promise<Paginated<AmcPlanDto>> => (await apiClient.get('/amc', { params: clean(q) })).data,
  get: async (id: string): Promise<AmcPlanDetailDto> => (await apiClient.get(`/amc/${id}`)).data,
  create: async (body: CreateAmcInput): Promise<AmcPlanDetailDto> => (await apiClient.post('/amc', body)).data,
  recordVisit: async (id: string, body: CreateAmcVisitInput): Promise<unknown> => (await apiClient.post(`/amc/${id}/visits`, body)).data,
  agreement: async (id: string): Promise<Blob> => (await apiClient.get(`/amc/${id}/agreement.pdf`, { responseType: 'blob' })).data,
};
