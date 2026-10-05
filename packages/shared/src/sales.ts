import { z } from 'zod';
import {
  BookingStatus,
  FinanceStatus,
  InsuranceStatus,
  PaymentMode,
  PaymentStatus,
  QuotationStatus,
  BOOKING_STATUSES,
  FINANCE_STATUSES,
  INSURANCE_STATUSES,
  PAYMENT_MODES,
  QUOTATION_STATUSES,
} from './enums';
import { paginationQuerySchema } from './pagination';
import { deliveryDateInputSchema } from './delivery';

const paise = z.coerce.number().int().min(0);
const money = paise.default(0);

const accessoryLine = z.object({
  accessoryId: z.string().uuid(),
  qty: z.coerce.number().int().min(1).default(1),
  unitPrice: paise,
});
export type AccessoryLineInput = z.infer<typeof accessoryLine>;

const priceBreakup = {
  exShowroom: money,
  discount: money,
  exchangeValue: money,
  rto: money,
  insurance: money,
  registration: money,
  extendedWarranty: money,
};

// ── Quotations ────────────────────────────────────────────
export const createQuotationSchema = z.object({
  customerId: z.string().uuid(),
  variantId: z.string().uuid(),
  ...priceBreakup,
  accessories: z.array(accessoryLine).default([]),
  financeDownPayment: money,
  financeLoanAmount: money,
  financeTenureMonths: z.coerce.number().int().min(0).max(120).default(0),
  financeEmi: money,
  validUntil: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export const updateQuotationSchema = createQuotationSchema.partial().omit({ customerId: true });
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;

export const changeQuotationStatusSchema = z.object({
  status: z.enum(QUOTATION_STATUSES as [QuotationStatus, ...QuotationStatus[]]),
});
export type ChangeQuotationStatusInput = z.infer<typeof changeQuotationStatusSchema>;

export const listQuotationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(QUOTATION_STATUSES as [QuotationStatus, ...QuotationStatus[]]).optional(),
  customerId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'code', 'status', 'total']).default('createdAt'),
});
export type ListQuotationsQuery = z.infer<typeof listQuotationsQuerySchema>;

export const convertQuotationSchema = z.object({
  unitId: z.string().uuid(),
  salesExecutiveId: z.string().uuid().optional(),
  expectedDelivery: z.coerce.date().optional(),
  advanceAmount: money,
});
export type ConvertQuotationInput = z.infer<typeof convertQuotationSchema>;

// ── Bookings ──────────────────────────────────────────────
export const createBookingSchema = z.object({
  customerId: z.string().uuid(),
  unitId: z.string().uuid(),
  salesExecutiveId: z.string().uuid().optional(),
  ...priceBreakup,
  accessories: z.array(accessoryLine).default([]),
  financeRequired: z.boolean().default(false),
  insuranceRequired: z.boolean().default(false),
  advanceAmount: money,
  expectedDelivery: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
/**
 * Editing a booking after creation must NOT change its commercial terms. Pricing, accessories,
 * advance, customer and vehicle are frozen at creation — only non-financial, operational fields may
 * change here. Any other key sent to PATCH /bookings/:id is ignored (stripped by this object schema),
 * so the restriction cannot be bypassed through the API. Creation pricing is unaffected.
 */
export const updateBookingSchema = z.object({
  financeRequired: z.boolean().optional(),
  insuranceRequired: z.boolean().optional(),
  expectedDelivery: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BOOKING_STATUSES as [BookingStatus, ...BookingStatus[]]).optional(),
  customerId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'code', 'status', 'expectedDelivery']).default('createdAt'),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

export const cancelBookingSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

// ── Payments ──────────────────────────────────────────────
export const addPaymentSchema = z.object({
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  mode: z.enum(PAYMENT_MODES as [PaymentMode, ...PaymentMode[]]),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.coerce.date().optional(),
});
export type AddPaymentInput = z.infer<typeof addPaymentSchema>;

// ── Finance ───────────────────────────────────────────────
export const upsertFinanceSchema = z.object({
  financeCompany: z.string().trim().min(1),
  downPayment: money,
  loanAmount: money,
  emiAmount: money,
  tenureMonths: z.coerce.number().int().min(0).max(120).default(0),
  interestRate: z.coerce.number().min(0).max(100).default(0),
  disbursedAmount: money,
  status: z.enum(FINANCE_STATUSES as [FinanceStatus, ...FinanceStatus[]]).default(FinanceStatus.PENDING),
});
export type UpsertFinanceInput = z.infer<typeof upsertFinanceSchema>;

// ── Insurance ─────────────────────────────────────────────
export const upsertInsuranceSchema = z.object({
  provider: z.string().trim().min(1),
  policyNumber: z.string().trim().max(80).optional(),
  premium: money,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(INSURANCE_STATUSES as [InsuranceStatus, ...InsuranceStatus[]]).default(InsuranceStatus.PENDING),
});
export type UpsertInsuranceInput = z.infer<typeof upsertInsuranceSchema>;

// ── Delivery scheduling ───────────────────────────────────
export const scheduleDeliverySchema = z.object({
  expectedDelivery: z.coerce.date().optional(),
  deliveryExecutiveId: z.string().uuid().optional(),
  pendingDocuments: z.string().trim().max(500).optional(),
});
export type ScheduleDeliveryInput = z.infer<typeof scheduleDeliverySchema>;

export const markDeliveredSchema = z.object({ actualDelivery: deliveryDateInputSchema.nullish() });
export type MarkDeliveredInput = z.infer<typeof markDeliveredSchema>;

// ── Accessories catalogue ─────────────────────────────────
export const createAccessorySchema = z.object({
  name: z.string().trim().min(1),
  sku: z.string().trim().optional(),
  category: z.string().trim().max(80).optional(),
  sellPrice: money,
  minStock: z.coerce.number().int().min(0).default(0),
  isPart: z.boolean().default(false),
});
export type CreateAccessoryInput = z.infer<typeof createAccessorySchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface AccessoryDto {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  sellPrice: string;
  /** Weighted-average moving cost (system-maintained). */
  avgCost: string;
  onHand: number;
  reserved: number;
  /** onHand - reserved. */
  available: number;
  minStock: number;
  isPart: boolean;
  isActive: boolean;
}
export interface PriceBreakup {
  exShowroom: string;
  discount: string;
  exchangeValue: string;
  accessoriesTotal: string;
  rto: string;
  insuranceCharge?: string;
  insurance?: string;
  registration: string;
  extendedWarranty: string;
  taxAmount?: string;
  total: string;
}
export interface PaymentSummary {
  total: string;
  paid: string;
  balance: string;
  status: PaymentStatus;
}
export interface PaymentDto {
  id: string;
  receiptNumber: string | null;
  amount: string;
  mode: PaymentMode;
  reference: string | null;
  paidAt: string;
}
export interface FinanceDto {
  id: string;
  financeCompany: string;
  downPayment: string;
  loanAmount: string;
  emiAmount: string;
  tenureMonths: number;
  interestRate: string;
  disbursedAmount: string;
  status: FinanceStatus;
}
export interface InsuranceDto {
  id: string;
  provider: string;
  policyNumber: string | null;
  premium: string;
  startDate: string | null;
  endDate: string | null;
  status: InsuranceStatus;
}
