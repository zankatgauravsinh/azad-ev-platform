import { z } from 'zod';
import { NOTIFICATION_TYPES, NOTIFICATION_PRIORITIES, type NotificationType, type NotificationPriority } from './enums';

const typeTuple = NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]];
const priorityTuple = NOTIFICATION_PRIORITIES as [NotificationPriority, ...NotificationPriority[]];
/** Query booleans arrive as the strings "true"/"false" (coerced in the service). */
const boolParam = z.enum(['true', 'false']);

export interface NotificationDto {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface UnreadCount {
  total: number;
}

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(typeTuple).optional(),
  priority: z.enum(priorityTuple).optional(),
  unread: boolParam.optional(),
  archived: boolParam.optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const createNotificationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  message: z.string().trim().min(1, 'Message is required').max(500),
  type: z.enum(typeTuple).default('SYSTEM'),
  priority: z.enum(priorityTuple).default('MEDIUM'),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().uuid().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
