import type {
  CompleteDeliveryInput,
  DeliveryDashboardDto,
  DeliveryDetailDto,
  DeliveryListRow,
  ListDeliveriesQuery,
  Paginated,
  ScheduleDeliveryInput2,
  UpdateChecklistInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL'));

export const deliveryApi = {
  list: async (q: Partial<ListDeliveriesQuery>): Promise<Paginated<DeliveryListRow>> => (await apiClient.get('/deliveries', { params: clean(q) })).data,
  dashboard: async (): Promise<DeliveryDashboardDto> => (await apiClient.get('/deliveries/dashboard')).data,
  detail: async (bookingId: string): Promise<DeliveryDetailDto> => (await apiClient.get(`/deliveries/${bookingId}`)).data,
  schedule: async (bookingId: string, body: ScheduleDeliveryInput2): Promise<DeliveryDetailDto> => (await apiClient.post(`/deliveries/${bookingId}/schedule`, body)).data,
  complete: async (bookingId: string, body: CompleteDeliveryInput): Promise<DeliveryDetailDto> => (await apiClient.post(`/deliveries/${bookingId}/complete`, body)).data,
  checklist: async (bookingId: string, body: UpdateChecklistInput): Promise<DeliveryDetailDto> => (await apiClient.patch(`/deliveries/${bookingId}/checklist`, body)).data,
  addPhoto: async (bookingId: string, file: File, label?: string): Promise<DeliveryDetailDto> => {
    const form = new FormData();
    form.append('file', file);
    if (label) form.append('label', label);
    return (await apiClient.post(`/deliveries/${bookingId}/photos`, form)).data;
  },
  removePhoto: async (bookingId: string, photoId: string): Promise<DeliveryDetailDto> => (await apiClient.delete(`/deliveries/${bookingId}/photos/${photoId}`)).data,
  setSignature: async (bookingId: string, file: File): Promise<DeliveryDetailDto> => {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.post(`/deliveries/${bookingId}/signature`, form)).data;
  },
  note: async (bookingId: string): Promise<Blob> => (await apiClient.get(`/deliveries/${bookingId}/note.pdf`, { responseType: 'blob' })).data,
};
