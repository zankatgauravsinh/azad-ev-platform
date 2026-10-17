import type {
  AccessorySaleDefaults,
  AccessorySaleDetailDto,
  AccessorySaleDto,
  AddAccessorySalePaymentInput,
  CancelAccessorySaleInput,
  CreateAccessorySaleInput,
  ListAccessorySalesQuery,
  Paginated,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const accessorySalesApi = {
  list: async (q: Partial<ListAccessorySalesQuery>): Promise<Paginated<AccessorySaleDto>> => (await apiClient.get('/accessory-sales', { params: clean(q) })).data,
  get: async (id: string): Promise<AccessorySaleDetailDto> => (await apiClient.get(`/accessory-sales/${id}`)).data,
  defaults: async (customerId?: string): Promise<AccessorySaleDefaults> => (await apiClient.get('/accessory-sales/defaults', { params: clean({ customerId }) })).data,
  create: async (body: CreateAccessorySaleInput): Promise<AccessorySaleDetailDto> => (await apiClient.post('/accessory-sales', body)).data,
  addPayment: async (id: string, body: AddAccessorySalePaymentInput): Promise<AccessorySaleDetailDto> => (await apiClient.post(`/accessory-sales/${id}/payments`, body)).data,
  cancel: async (id: string, body: CancelAccessorySaleInput): Promise<AccessorySaleDetailDto> => (await apiClient.post(`/accessory-sales/${id}/cancel`, body)).data,
  pdf: async (id: string): Promise<Blob> => (await apiClient.get(`/accessory-sales/${id}/pdf`, { responseType: 'blob' })).data,
};
