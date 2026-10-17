import type { AccessoryDetailDto, AccessoryDto, AccessoryListStatus, CreateAccessoryInput, OpeningStockInput, StockAdjustmentInput, UpdateAccessoryInput } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface AccessoryFilters {
  q?: string;
  category?: string;
  status?: AccessoryListStatus;
  lowStock?: boolean;
}

const params = (f: AccessoryFilters): Record<string, string> =>
  Object.fromEntries(
    Object.entries({ q: f.q, category: f.category, status: f.status, lowStock: f.lowStock ? 'true' : undefined }).filter((e): e is [string, string] => Boolean(e[1])),
  );

export const accessoriesApi = {
  list: async (f: AccessoryFilters): Promise<AccessoryDto[]> => (await apiClient.get('/accessories', { params: params(f) })).data,
  categories: async (): Promise<string[]> => (await apiClient.get('/accessories/categories')).data,
  get: async (id: string): Promise<AccessoryDetailDto> => (await apiClient.get(`/accessories/${id}`)).data,
  create: async (body: CreateAccessoryInput): Promise<AccessoryDto> => (await apiClient.post('/accessories', body)).data,
  update: async (id: string, body: UpdateAccessoryInput): Promise<AccessoryDto> => (await apiClient.patch(`/accessories/${id}`, body)).data,
  setActive: async (id: string, active: boolean): Promise<AccessoryDto> => (await apiClient.post(`/accessories/${id}/${active ? 'activate' : 'deactivate'}`)).data,
  openingStock: async (id: string, body: OpeningStockInput): Promise<AccessoryDetailDto> => (await apiClient.post(`/accessories/${id}/opening-stock`, body)).data,
  adjust: async (id: string, body: StockAdjustmentInput): Promise<AccessoryDetailDto> => (await apiClient.post(`/accessories/${id}/adjustments`, body)).data,
};
