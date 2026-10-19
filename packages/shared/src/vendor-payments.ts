import { z } from 'zod';
import { FINANCE_PAY_METHODS, type FinancePayMethod, type UnitStatus } from './enums';
import { paginationQuerySchema } from './pagination';

/* ── Vendor bills & payments ───────────────────────────────────────────────────────────────────
 * A vendor BILL is anything owed to a vendor: a scooter bought from them (its purchase cost — price + GST +
 * transport), an accessory purchase, or an approved expense with that vendor. A vendor PAYMENT is money paid to
 * the vendor: it settles one or more bills (each in full or in part) and whatever is left over stays with the
 * vendor as an ADVANCE, applied to bills later (e.g. an advance against a purchase order's PI). Cancelling a
 * payment makes its bills unpaid again. Scooter and accessory-purchase bills are purchase cost: only users with
 * inventory.cost see or pay them.
 */
export const VENDOR_BILL_KINDS = ['SCOOTER', 'ACCESSORY_PURCHASE', 'EXPENSE'] as const;
export type VendorBillKind = (typeof VENDOR_BILL_KINDS)[number];
export const VENDOR_BILL_KIND_LABEL: Record<VendorBillKind, string> = {
  SCOOTER: 'Scooter',
  ACCESSORY_PURCHASE: 'Accessory purchase',
  EXPENSE: 'Expense',
};
/** Bill kinds that carry purchase cost (need inventory.cost). */
export const PURCHASE_COST_BILL_KINDS: readonly VendorBillKind[] = ['SCOOTER', 'ACCESSORY_PURCHASE'];

export const VENDOR_PAYMENT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type VendorPaymentStatus = (typeof VENDOR_PAYMENT_STATUSES)[number];

/** Overdue buckets, by days past the due date (bill date + the vendor's credit days). */
export const AGEING_BUCKETS = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export const AGEING_BUCKET_LABEL: Record<AgeingBucket, string> = {
  NOT_DUE: 'Not due yet',
  D1_30: '1–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: 'Over 90 days',
};
export function ageingBucketOf(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return 'NOT_DUE';
  if (daysOverdue <= 30) return 'D1_30';
  if (daysOverdue <= 60) return 'D31_60';
  if (daysOverdue <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export interface VendorBillDto {
  kind: VendorBillKind;
  /** The scooter, accessory purchase or expense id. */
  id: string;
  vendorId: string;
  /** VIN, purchase number or expense number. */
  number: string;
  /** The vendor's own bill / invoice number, when recorded. */
  vendorBillNumber: string | null;
  description: string;
  /** Bill date (ISO). */
  date: string;
  /** When it falls due: the bill date + the vendor's credit days (an expense's own due date wins). */
  dueDate: string;
  /** Total of the bill, with GST. */
  amount: string;
  /** Paid through vendor payments so far. */
  allocated: string;
  /** Still owed: amount − allocated, or 0 when it was paid directly. */
  balance: string;
  paid: boolean;
  /** When it was paid in full, if it is. */
  paidAt: string | null;
  /** Days past the due date (negative = days left); 0 when paid. */
  daysOverdue: number;
  /** Only for scooters: its stock status. */
  unitStatus?: UnitStatus;
}

export interface VendorPaymentAllocationDto {
  id: string;
  kind: VendorBillKind;
  billId: string;
  billNumber: string;
  description: string;
  amount: string;
  appliedAt: string;
}

export interface VendorPaymentDto {
  id: string;
  paymentNumber: string;
  vendorId: string;
  vendorName: string;
  paidAt: string;
  method: FinancePayMethod;
  reference: string | null;
  amount: string;
  /** Applied to bills (active allocations). */
  applied: string;
  /** Left with the vendor as an advance: amount − applied. */
  unapplied: string;
  notes: string | null;
  purchaseOrderId: string | null;
  poNumber: string | null;
  status: VendorPaymentStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdByName: string | null;
  createdAt: string;
  allocations: VendorPaymentAllocationDto[];
}

const paise = z.coerce.number().int().min(0);
const payMethod = z.enum(FINANCE_PAY_METHODS as [FinancePayMethod, ...FinancePayMethod[]]);

export const vendorAllocationInputSchema = z.object({
  kind: z.enum(VENDOR_BILL_KINDS),
  billId: z.string().uuid(),
  /** Paise applied to this bill — at most what is still owed on it. */
  amount: paise.refine((v) => v > 0, 'Enter an amount'),
});
export type VendorAllocationInput = z.infer<typeof vendorAllocationInputSchema>;

const allocationList = z
  .array(vendorAllocationInputSchema)
  .max(200)
  .refine((list) => new Set(list.map((a) => `${a.kind}:${a.billId}`)).size === list.length, { message: 'Each bill once' });

export const createVendorPaymentSchema = z
  .object({
    vendorId: z.string().uuid('Choose a vendor'),
    /** The payment date (calendar date). Defaults to today; never in the future. */
    paidAt: z.coerce.date().optional(),
    method: payMethod,
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
    /** Total paid (paise). What is not applied to bills stays as an advance. */
    amount: paise.refine((v) => v > 0, 'Enter the amount paid'),
    /** An advance against this purchase order. */
    purchaseOrderId: z.string().uuid().optional(),
    allocations: allocationList.default([]),
  })
  .refine((p) => p.allocations.reduce((a, l) => a + l.amount, 0) <= p.amount, {
    message: 'The bills selected add up to more than the amount paid',
    path: ['amount'],
  });
export type CreateVendorPaymentInput = z.infer<typeof createVendorPaymentSchema>;

/** Apply the advance left on a payment to bills. */
export const applyVendorPaymentSchema = z.object({
  allocations: allocationList.refine((list) => list.length > 0, { message: 'Choose at least one bill' }),
});
export type ApplyVendorPaymentInput = z.infer<typeof applyVendorPaymentSchema>;

export const cancelVendorPaymentSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
});
export type CancelVendorPaymentInput = z.infer<typeof cancelVendorPaymentSchema>;

export const listVendorPaymentsQuerySchema = paginationQuerySchema.extend({
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  status: z.enum(VENDOR_PAYMENT_STATUSES).optional(),
  /** Only payments with advance left to apply. */
  withAdvance: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListVendorPaymentsQuery = z.infer<typeof listVendorPaymentsQuerySchema>;

export const listVendorBillsQuerySchema = z.object({
  /** 'unpaid' (default): bills with something still owed; 'all': every bill. */
  status: z.enum(['unpaid', 'all']).default('unpaid'),
  kind: z.enum(VENDOR_BILL_KINDS).optional(),
});
export type ListVendorBillsQuery = z.infer<typeof listVendorBillsQuerySchema>;

/* ── Vendor 360 ────────────────────────────────────────────────────────────────────────────── */

export interface VendorAgeingDto {
  buckets: { bucket: AgeingBucket; amount: string; count: number }[];
  /** Everything still owed on bills. */
  totalDue: string;
  /** Owed on bills past their due date. */
  overdue: string;
}

export interface VendorOverviewDto {
  /** Bills (with GST) in total, all time. */
  totalBilled: string;
  /** Paid to the vendor in total (vendor payments + bills paid directly). */
  totalPaid: string;
  /** Still owed on bills. */
  billsDue: string;
  /** Paid in advance and not yet applied to a bill. */
  advance: string;
  /** Net payable: billsDue − advance (negative = the vendor owes you / holds your advance). */
  netPayable: string;
  overdue: string;
  ageing: VendorAgeingDto;
  scooters: { total: number; inStock: number; sold: number; unpaid: number; expensedBefore: number };
  /** What the scooters bought before per-scooter tracking cost (recorded as expenses then) — purchase cost only. */
  expensedBeforeCost: string | null;
  accessoryPurchases: number;
  openPurchaseOrders: number;
  lastPurchaseDate: string | null;
  lastPaymentDate: string | null;
  /** True when the caller cannot see purchase cost: scooter and accessory-purchase bills are left out of every figure. */
  costHidden: boolean;
}

export const vendorStatementQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type VendorStatementQuery = z.infer<typeof vendorStatementQuerySchema>;

export type VendorStatementRowType = 'BILL' | 'PAYMENT' | 'CANCELLED_BILL';
export interface VendorStatementRow {
  date: string;
  type: VendorStatementRowType;
  /** Bill or payment number. */
  number: string;
  description: string;
  /** What the showroom owes more (a bill). */
  billed: string;
  /** What was paid (a payment). */
  paid: string;
  /** Owed after this row (negative = advance with the vendor). */
  balance: string;
}

export interface VendorStatementDto {
  vendor: { id: string; vendorNumber: string; name: string; gstNumber: string | null; address: string | null };
  from: string | null;
  to: string;
  opening: string;
  totalBilled: string;
  totalPaid: string;
  closing: string;
  rows: VendorStatementRow[];
  costHidden: boolean;
}

/** Owed to vendors across the showroom (finance dashboard / vendors list). */
export interface PayablesSummaryDto {
  billsDue: string;
  overdue: string;
  dueIn7Days: number;
  advance: string;
}
