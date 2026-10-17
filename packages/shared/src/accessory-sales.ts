import { z } from 'zod';
import { PAYMENT_MODES, type PaymentMode } from './enums';
import { RTO_MAX_GST_RATE, RTO_SUPPLY_TYPES, type RtoSupplyType } from './rto';

/*
 * Accessory counter sales: accessories sold on their own invoice, never on the scooter's. Stock leaves when the
 * sale is made; prices are per piece and — when the invoice carries GST (Settings) — include GST, which the
 * invoice splits out. A sale is to a customer, optionally noting one of their bookings. Payments may be part;
 * the balance is paid later. A wrong sale is cancelled (owner / manager): stock returns and what was paid is
 * refunded. The invoice number is never reused.
 */

const paise = z.coerce.number().int().min(0);
export const ACCESSORY_SALE_MAX_LINES = 50;
export const ACCESSORY_SALE_MAX_QTY = 1000;

export const AccessorySaleStatus = { ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' } as const;
export type AccessorySaleStatus = (typeof AccessorySaleStatus)[keyof typeof AccessorySaleStatus];
export const ACCESSORY_SALE_STATUSES = Object.values(AccessorySaleStatus);

export type AccessoryPaymentStatus = 'PAID' | 'PARTIAL' | 'PENDING';

/** GST contained in a GST-inclusive amount. */
export interface InclusiveGst {
  taxable: bigint;
  gst: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
}

/**
 * Splits the GST out of a GST-inclusive amount: taxable = amount × 100 / (100 + rate), half-up to the paisa; GST =
 * amount − taxable, so the two always add back to the amount. Within the state the GST is CGST (half, rounded
 * down) + SGST (the rest); in another state it is IGST. Shared by the API (which stores it) and the form.
 */
export function splitInclusiveGst(amount: bigint, rateBp: number, supplyType: RtoSupplyType): InclusiveGst {
  if (rateBp <= 0 || amount <= 0n) return { taxable: amount, gst: 0n, cgst: 0n, sgst: 0n, igst: 0n };
  const base = 10000n + BigInt(rateBp);
  const taxable = (amount * 10000n * 2n + base) / (2n * base);
  const gst = amount - taxable;
  const cgst = supplyType === 'INTRA' ? gst / 2n : 0n;
  return { taxable, gst, cgst, sgst: supplyType === 'INTRA' ? gst - cgst : 0n, igst: supplyType === 'INTER' ? gst : 0n };
}

const saleLine = z.object({
  accessoryId: z.string().uuid('Choose an accessory'),
  qty: z.coerce.number().int('Whole pieces only').min(1, 'At least 1').max(ACCESSORY_SALE_MAX_QTY, `At most ${ACCESSORY_SALE_MAX_QTY}`),
  /** Price per piece charged (paise) — defaults to the catalogue price; GST included when the invoice has GST. */
  unitPrice: paise,
});
export type AccessorySaleLineInput = z.infer<typeof saleLine>;

const paymentMode = z.enum(PAYMENT_MODES as [PaymentMode, ...PaymentMode[]]);
const reference = z.string().trim().max(120).optional();

export const createAccessorySaleSchema = z.object({
  customerId: z.string().uuid('Choose a customer'),
  /** One of the customer's bookings, for reference (the accessories are NOT added to that invoice). */
  bookingId: z.string().uuid().optional(),
  /** Defaults from the customer's and your GST state codes; only used when the invoice carries GST. */
  supplyType: z.enum(RTO_SUPPLY_TYPES as [RtoSupplyType, ...RtoSupplyType[]]).optional(),
  items: z
    .array(saleLine)
    .min(1, 'Add at least one accessory')
    .max(ACCESSORY_SALE_MAX_LINES)
    .refine((lines) => new Set(lines.map((l) => l.accessoryId)).size === lines.length, { message: 'Each accessory once — change its quantity instead' }),
  notes: z.string().trim().max(500).optional(),
  /** Paid now (optional; the balance can be paid later). */
  payment: z
    .object({ amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'), mode: paymentMode, reference })
    .optional(),
});
export type CreateAccessorySaleInput = z.infer<typeof createAccessorySaleSchema>;

export const addAccessorySalePaymentSchema = z.object({
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  mode: paymentMode,
  reference,
});
export type AddAccessorySalePaymentInput = z.infer<typeof addAccessorySalePaymentSchema>;

/** Owner / manager. Stock returns; anything paid is refunded by `refundMode` (required when something was paid). */
export const cancelAccessorySaleSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  refundMode: paymentMode.optional(),
  refundReference: reference,
});
export type CancelAccessorySaleInput = z.infer<typeof cancelAccessorySaleSchema>;

export const listAccessorySalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Invoice number, customer name or phone. */
  q: z.string().trim().max(120).optional(),
  status: z.enum(ACCESSORY_SALE_STATUSES as [AccessorySaleStatus, ...AccessorySaleStatus[]]).optional(),
  customerId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  accessoryId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAccessorySalesQuery = z.infer<typeof listAccessorySalesQuerySchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface AccessorySaleDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: AccessorySaleStatus;
  customer: { id: string; name: string; phone: string };
  booking: { id: string; code: string } | null;
  gstApplied: boolean;
  supplyType: RtoSupplyType | null;
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  gstAmount: string;
  total: string;
  paid: string;
  refunded: string;
  /** total − paid (0 once cancelled). */
  balance: string;
  paymentStatus: AccessoryPaymentStatus;
  itemCount: number;
  /** "Helmet × 2, Guard" — for lists. */
  itemsSummary: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface AccessorySaleItemDto {
  id: string;
  accessoryId: string;
  name: string;
  sku: string | null;
  hsnCode: string | null;
  qty: number;
  unitPrice: string;
  gstRateBp: number;
  taxable: string;
  gstAmount: string;
  lineTotal: string;
  /** Cost per piece when sold — present only for users with inventory.cost. */
  costAtSale?: string;
}

export interface AccessorySalePaymentDto {
  id: string;
  receiptNumber: string | null;
  amount: string;
  mode: PaymentMode;
  reference: string | null;
  paidAt: string;
  receivedByName: string | null;
}

export interface AccessorySaleRefundDto {
  id: string;
  refundNumber: string;
  amount: string;
  method: PaymentMode;
  reference: string | null;
  refundedAt: string;
}

export interface AccessorySaleDetailDto extends AccessorySaleDto {
  items: AccessorySaleItemDto[];
  payments: AccessorySalePaymentDto[];
  refunds: AccessorySaleRefundDto[];
}

/** What the new-sale form needs: whether GST applies, the rate per accessory, and the supply type for the customer. */
export interface AccessorySaleDefaults {
  gstEnabled: boolean;
  /** Rate for an accessory without a GST classification (basis points). */
  defaultGstRateBp: number;
  /** accessoryId → its GST rate (basis points) and HSN code, from its GST classification. */
  rates: Record<string, { gstRateBp: number; hsnCode: string | null }>;
  supplyType: RtoSupplyType;
  supplyTypeHint: string;
  /** The customer's live bookings, to optionally note on the sale. */
  bookings: { id: string; code: string; status: string }[];
}

/** The top GST slab, in percent — the highest accessory GST rate accepted in Settings. */
export const ACCESSORY_MAX_GST_RATE = RTO_MAX_GST_RATE;
