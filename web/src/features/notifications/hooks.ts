import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListNotificationsQuery } from '@azad/shared';
import { notificationsApi } from './api';

const key = ['notifications'];

export function useUnreadCount() {
  return useQuery({
    queryKey: [...key, 'unread'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000, // keep the bell badge roughly live
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(filters: Partial<ListNotificationsQuery>) {
  return useInfiniteQuery({
    queryKey: [...key, 'list', filters],
    queryFn: ({ pageParam }) => notificationsApi.list({ ...filters, page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = (): void => { void qc.invalidateQueries({ queryKey: key }); };
  return {
    refresh: useMutation({ mutationFn: notificationsApi.refresh, onSuccess: invalidate }),
    markRead: useMutation({ mutationFn: notificationsApi.markRead, onSuccess: invalidate }),
    markAllRead: useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: invalidate }),
    archive: useMutation({ mutationFn: notificationsApi.archive, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: notificationsApi.remove, onSuccess: invalidate }),
  };
}
