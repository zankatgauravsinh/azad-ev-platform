import type { AuditEntryDto, AuditExportFormat, AuditFacetsDto, ListAuditQuery, Paginated } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export type AuditFilters = Partial<Omit<ListAuditQuery, 'page' | 'pageSize'>>;

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null));

export const auditApi = {
  list: async (q: Partial<ListAuditQuery>): Promise<Paginated<AuditEntryDto>> => (await apiClient.get('/audit-log', { params: clean(q) })).data,
  get: async (id: string): Promise<AuditEntryDto> => (await apiClient.get(`/audit-log/${id}`)).data,
  facets: async (): Promise<AuditFacetsDto> => (await apiClient.get('/audit-log/facets')).data,
  history: async (entityType: string, entityId: string, page: number): Promise<Paginated<AuditEntryDto>> =>
    (await apiClient.get('/audit-log/history', { params: { entityType, entityId, page, pageSize: 20 } })).data,
  export: async (filters: AuditFilters, format: AuditExportFormat): Promise<Blob> =>
    (await apiClient.get('/audit-log/export', { params: clean({ ...filters, format }), responseType: 'blob' })).data,
};
