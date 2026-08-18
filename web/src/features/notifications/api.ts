import type { CreateNotificationInput, ListNotificationsQuery, NotificationDto, Paginated, UnreadCount } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export const notificationsApi = {
  list: async (q: Partial<ListNotificationsQuery>): Promise<Paginated<NotificationDto>> => (await apiClient.get('/notifications', { params: q })).data,
  unreadCount: async (): Promise<UnreadCount> => (await apiClient.get('/notifications/unread-count')).data,
  refresh: async (): Promise<{ created: number }> => (await apiClient.post('/notifications/refresh')).data,
  create: async (input: CreateNotificationInput): Promise<NotificationDto> => (await apiClient.post('/notifications', input)).data,
  markRead: async (id: string): Promise<NotificationDto> => (await apiClient.patch(`/notifications/${id}/read`)).data,
  markAllRead: async (): Promise<{ updated: number }> => (await apiClient.patch('/notifications/read-all')).data,
  archive: async (id: string): Promise<NotificationDto> => (await apiClient.patch(`/notifications/${id}/archive`)).data,
  remove: async (id: string): Promise<void> => { await apiClient.delete(`/notifications/${id}`); },
};
