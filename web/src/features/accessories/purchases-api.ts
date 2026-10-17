import type {
  AccessoryPurchaseDetailDto,
  AccessoryPurchaseDto,
  CancelAccessoryPurchaseInput,
  CreateAccessoryPurchaseInput,
  ListAccessoryPurchasesQuery,
  MarkAccessoryPurchasePaidInput,
  Paginated,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

type ListParams = Partial<Omit<ListAccessoryPurchasesQuery, 'paid'>> & { paid?: boolean };
const clean = (q: ListParams): Record<string, unknown> =>
  Object.fromEntries(Object.entries({ ...q, paid: q.paid === undefined ? undefined : String(q.paid) }).filter(([, v]) => v !== undefined && v !== ''));

export const accessoryPurchasesApi = {
  list: async (q: ListParams): Promise<Paginated<AccessoryPurchaseDto>> => (await apiClient.get('/accessory-purchases', { params: clean(q) })).data,
  get: async (id: string): Promise<AccessoryPurchaseDetailDto> => (await apiClient.get(`/accessory-purchases/${id}`)).data,
  defaults: async (): Promise<{ rates: Record<string, { gstRateBp: number; hsnCode: string | null }> }> => (await apiClient.get('/accessory-purchases/defaults')).data,
  create: async (body: CreateAccessoryPurchaseInput): Promise<AccessoryPurchaseDetailDto> => (await apiClient.post('/accessory-purchases', body)).data,
  pay: async (id: string, body: MarkAccessoryPurchasePaidInput): Promise<AccessoryPurchaseDetailDto> => (await apiClient.post(`/accessory-purchases/${id}/pay`, body)).data,
  cancel: async (id: string, body: CancelAccessoryPurchaseInput): Promise<AccessoryPurchaseDetailDto> => (await apiClient.post(`/accessory-purchases/${id}/cancel`, body)).data,
};
export type PurchaseListParams = ListParams;
