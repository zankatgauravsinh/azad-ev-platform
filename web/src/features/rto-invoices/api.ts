import type { GenerateRtoInvoiceInput, ListRtoInvoicesQuery, Paginated, ReviseRtoInvoiceInput, RtoInvoiceDefaults, RtoInvoiceDto } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const rtoApi = {
  list: async (q: Partial<ListRtoInvoicesQuery>): Promise<Paginated<RtoInvoiceDto>> => (await apiClient.get('/rto-invoices', { params: clean(q) })).data,
  detail: async (id: string): Promise<RtoInvoiceDto> => (await apiClient.get(`/rto-invoices/${id}`)).data,
  defaults: async (bookingId: string): Promise<RtoInvoiceDefaults> => (await apiClient.get('/rto-invoices/defaults', { params: { bookingId } })).data,
  generate: async (body: GenerateRtoInvoiceInput): Promise<RtoInvoiceDto> => (await apiClient.post('/rto-invoices', body)).data,
  revise: async (id: string, body: ReviseRtoInvoiceInput): Promise<RtoInvoiceDto> => (await apiClient.patch(`/rto-invoices/${id}`, body)).data,
  pdf: async (id: string): Promise<Blob> => (await apiClient.get(`/rto-invoices/${id}/pdf`, { responseType: 'blob' })).data,
};
