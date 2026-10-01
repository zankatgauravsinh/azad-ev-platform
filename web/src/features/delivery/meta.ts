import type { DeliveryChecklistItem, DeliveryStatus } from '@azad/shared';

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

export const deliveryStatusTone: Record<DeliveryStatus, BadgeTone> = {
  AWAITING_PAYMENT: 'destructive',
  READY: 'accent',
  SCHEDULED: 'info',
  OVERDUE: 'warning',
  DELIVERED: 'success',
};

export const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  READY: 'Ready',
  SCHEDULED: 'Scheduled',
  OVERDUE: 'Overdue',
  DELIVERED: 'Delivered',
};

export const checklistLabel: Record<DeliveryChecklistItem, string> = {
  keys: 'Keys',
  charged: 'Vehicle charged',
  charger: 'Charger',
  helmet: 'Helmet',
  accessoriesFitted: 'Accessories fitted',
  documents: 'KYC documents',
  invoice: 'Tax invoice',
  insurance: 'Insurance policy',
  rcBook: 'RC / registration',
  warrantyCard: 'Warranty card',
};
