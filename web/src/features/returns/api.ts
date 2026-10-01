import type {
  ApproveReturnInput,
  CancelReturnInput,
  CompleteReturnInput,
  CreateReturnInput,
  InspectReturnInput,
  ListReturnsQuery,
  Paginated,
  RejectReturnInput,
  VehicleReturnDto,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL'));

export const returnsApi = {
  list: async (q: Partial<ListReturnsQuery>): Promise<Paginated<VehicleReturnDto>> => (await apiClient.get('/returns', { params: clean(q) })).data,
  detail: async (id: string): Promise<VehicleReturnDto> => (await apiClient.get(`/returns/${id}`)).data,
  request: async (body: CreateReturnInput): Promise<VehicleReturnDto> => (await apiClient.post('/returns', body)).data,
  inspect: async (id: string, body: InspectReturnInput): Promise<VehicleReturnDto> => (await apiClient.post(`/returns/${id}/inspect`, body)).data,
  approve: async (id: string, body: ApproveReturnInput = {}): Promise<VehicleReturnDto> => (await apiClient.post(`/returns/${id}/approve`, body)).data,
  reject: async (id: string, body: RejectReturnInput): Promise<VehicleReturnDto> => (await apiClient.post(`/returns/${id}/reject`, body)).data,
  cancel: async (id: string, body: CancelReturnInput): Promise<VehicleReturnDto> => (await apiClient.post(`/returns/${id}/cancel`, body)).data,
  complete: async (id: string, body: CompleteReturnInput): Promise<VehicleReturnDto> => (await apiClient.post(`/returns/${id}/complete`, body)).data,
};
