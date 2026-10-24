import type {
  CancelPurchaseOrderInput,
  CreatePurchaseOrderInput,
  LinkStockInput,
  StockCandidateDto,
  ListPurchaseOrdersQuery,
  Paginated,
  PurchaseOrderDetailDto,
  PurchaseOrderDocumentType,
  PurchaseOrderDto,
  UpdatePurchaseOrderInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export type PurchaseOrderListParams = Partial<Omit<ListPurchaseOrdersQuery, 'pending'>> & { pending?: boolean };
const clean = (q: PurchaseOrderListParams): Record<string, unknown> =>
  Object.fromEntries(Object.entries({ ...q, pending: q.pending === undefined ? undefined : String(q.pending) }).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL'));

export const purchaseOrdersApi = {
  list: async (q: PurchaseOrderListParams): Promise<Paginated<PurchaseOrderDto>> => (await apiClient.get('/purchase-orders', { params: clean(q) })).data,
  get: async (id: string): Promise<PurchaseOrderDetailDto> => (await apiClient.get(`/purchase-orders/${id}`)).data,
  create: async (body: CreatePurchaseOrderInput): Promise<PurchaseOrderDetailDto> => (await apiClient.post('/purchase-orders', body)).data,
  update: async (id: string, body: UpdatePurchaseOrderInput): Promise<PurchaseOrderDetailDto> => (await apiClient.patch(`/purchase-orders/${id}`, body)).data,
  markOrdered: async (id: string): Promise<PurchaseOrderDetailDto> => (await apiClient.post(`/purchase-orders/${id}/order`)).data,
  close: async (id: string): Promise<PurchaseOrderDetailDto> => (await apiClient.post(`/purchase-orders/${id}/close`)).data,
  reopen: async (id: string): Promise<PurchaseOrderDetailDto> => (await apiClient.post(`/purchase-orders/${id}/reopen`)).data,
  cancel: async (id: string, body: CancelPurchaseOrderInput): Promise<PurchaseOrderDetailDto> => (await apiClient.post(`/purchase-orders/${id}/cancel`, body)).data,
  pdf: async (id: string): Promise<Blob> => (await apiClient.get(`/purchase-orders/${id}/pdf`, { responseType: 'blob' })).data,
  addDocument: async (id: string, file: File, type: PurchaseOrderDocumentType): Promise<PurchaseOrderDetailDto> => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    return (await apiClient.post(`/purchase-orders/${id}/documents`, form)).data;
  },
  /** Scooters already in stock that can be linked to a scooter line, and linking them (owner). */
  stockCandidates: async (id: string, lineId: string): Promise<StockCandidateDto[]> => (await apiClient.get(`/purchase-orders/${id}/lines/${lineId}/stock`)).data,
  linkStock: async (id: string, lineId: string, body: LinkStockInput): Promise<PurchaseOrderDetailDto> => (await apiClient.post(`/purchase-orders/${id}/lines/${lineId}/link`, body)).data,
  removeDocument: async (id: string, documentId: string): Promise<PurchaseOrderDetailDto> => (await apiClient.delete(`/purchase-orders/${id}/documents/${documentId}`)).data,
};
