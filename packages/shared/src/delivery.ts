import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Module — Delivery workflow
 * ------------------------------------------------------------------ */

/** Where a booking sits in the delivery pipeline (computed, not stored). */
export const DeliveryStatus = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  READY: 'READY',
  SCHEDULED: 'SCHEDULED',
  OVERDUE: 'OVERDUE',
  DELIVERED: 'DELIVERED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const DELIVERY_STATUSES = Object.values(DeliveryStatus);

/** Handover / pre-delivery-inspection checklist items, in display order. */
export const DELIVERY_CHECKLIST_ITEMS = [
  'keys',
  'charged',
  'charger',
  'helmet',
  'accessoriesFitted',
  'documents',
  'invoice',
  'insurance',
  'rcBook',
  'warrantyCard',
] as const;
export type DeliveryChecklistItem = (typeof DELIVERY_CHECKLIST_ITEMS)[number];
export type DeliveryChecklistDto = Record<DeliveryChecklistItem, boolean>;

export interface DeliveryPhotoDto {
  id: string;
  url: string;
  label: string | null;
  createdAt: string;
}

export interface DeliveryListRow {
  bookingId: string;
  code: string;
  status: DeliveryStatus;
  customerId: string;
  customerName: string;
  customerPhone: string;
  model: string;
  variant: string;
  vin: string;
  invoiceNumber: string | null;
  expectedDelivery: string | null;
  actualDelivery: string | null;
  deliveryExecutive: string | null;
  balance: string;
  pendingDocuments: string | null;
}

export interface DeliveryDetailDto {
  booking: DeliveryListRow & {
    address: string | null;
    city: string | null;
    salesExecutive: string | null;
    motorNumber: string | null;
    batteryNumber: string | null;
    total: string;
    paid: string;
  };
  delivery: {
    id: string;
    deliveredAt: string;
    deliveredBy: string | null;
    notes: string | null;
    overrideReason: string | null;
    signatureUrl: string | null;
    googleReviewSent: boolean;
    checklist: DeliveryChecklistDto;
    photos: DeliveryPhotoDto[];
  } | null;
}

export interface DeliveryDashboardDto {
  readyToDeliver: number;
  scheduledToday: number;
  overdue: number;
  awaitingPayment: number;
  deliveredThisMonth: number;
  pendingDocuments: number;
}

/* ── Delivery date ── */

/** A business calendar date in 'YYYY-MM-DD' form. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar day in 'YYYY-MM-DD' form (rejects 2026-02-30, timestamps, …). */
export function isCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The delivery date sent when a vehicle is handed over.
 *
 *  - 'YYYY-MM-DD' — the business CALENDAR DATE of the handover, in the company's time zone. This is
 *    what the application sends. It is kept as a string: it is a date, not an instant.
 *  - anything else the API accepted before (an ISO timestamp) — an instant, kept for older clients.
 *  - omitted / null — "now".
 *
 * The server decides what counts as "today" (company time zone) and rejects a future date.
 */
export const deliveryDateInputSchema = z.unknown().transform((value, ctx): string | Date => {
  if (typeof value === 'string' && CALENDAR_DATE.test(value.trim())) {
    const day = value.trim();
    if (isCalendarDateString(day)) return day;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Delivery date is not a valid date' });
    return z.NEVER;
  }
  const instant = typeof value === 'boolean' ? null : z.coerce.date().safeParse(value);
  if (instant?.success) return instant.data;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Delivery date is not a valid date' });
  return z.NEVER;
});
export type DeliveryDateInput = z.infer<typeof deliveryDateInputSchema>;

/* ── Input schemas ── */

const checklistShape = Object.fromEntries(DELIVERY_CHECKLIST_ITEMS.map((k) => [k, z.boolean().optional()])) as Record<
  DeliveryChecklistItem,
  z.ZodOptional<z.ZodBoolean>
>;

export const listDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(DELIVERY_STATUSES as [DeliveryStatus, ...DeliveryStatus[]]).optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const scheduleDeliveryInputSchema = z.object({
  expectedDelivery: z.coerce.date().optional(),
  deliveryExecutiveId: z.string().uuid().optional(),
  pendingDocuments: z.string().trim().max(300).optional(),
});
export type ScheduleDeliveryInput2 = z.infer<typeof scheduleDeliveryInputSchema>;

export const updateChecklistSchema = z.object(checklistShape);
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;

export const completeDeliverySchema = z.object({
  actualDelivery: deliveryDateInputSchema.nullish(),
  notes: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(300).optional(),
  checklist: z.object(checklistShape).optional(),
});
export type CompleteDeliveryInput = z.infer<typeof completeDeliverySchema>;
