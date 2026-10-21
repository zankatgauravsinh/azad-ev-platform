import type { ActivityAction } from '@azad/shared';

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

export const auditActionTone: Record<ActivityAction, BadgeTone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
  STATUS_CHANGE: 'accent',
  LOGIN: 'muted',
  PAYMENT: 'success',
  EXPORT: 'muted',
  LOGIN_FAILED: 'warning',
  LOGOUT: 'muted',
  DOWNLOAD: 'muted',
  SHARE_OPEN: 'muted',
  CANCEL: 'destructive',
  APPROVE: 'success',
};

/** Where a record lives in the app, for "Open record" (stored model names and automatic-entry route segments). */
const RECORD_PATH: Record<string, string> = {
  Customer: '/customers', customers: '/customers',
  Quotation: '/quotations', quotations: '/quotations',
  Booking: '/bookings', bookings: '/bookings',
  InventoryUnit: '/inventory', inventory: '/inventory',
  ServiceJob: '/service', service: '/service',
  Vendor: '/vendors', vendors: '/vendors',
  PurchaseOrder: '/purchase-orders', 'purchase-orders': '/purchase-orders',
};

export function recordPath(entityType: string, entityId: string | null): string | null {
  const base = RECORD_PATH[entityType];
  return base && entityId ? `${base}/${entityId}` : null;
}

/** "2 Oct 2026, 4:35 pm". */
export const formatWhen = (iso: string): string => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** A readable device name from a user agent: "Chrome on Windows", "Android app"… */
export function deviceOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : null;
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad|iOS/.test(userAgent) ? 'iPhone / iPad' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 60);
}
