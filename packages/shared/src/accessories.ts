import { z } from 'zod';
import { AccessoryMovementType, FINANCE_PAY_METHODS, type FinancePayMethod } from './enums';
import { paginationQuerySchema } from './pagination';

const paise = z.coerce.number().int().min(0);

// ── Catalogue ─────────────────────────────────────────────
/*
 * An accessory's catalogue details are edited here; its stock and cost never are. On hand, reserved and the
 * weighted-average cost (avgCost) change only through stock movements — opening stock, purchases, adjustments,
 * booking reservations and deliveries. The average cost is purchase cost: only users with inventory.cost (the
 * owner, by default) receive it.
 */
export const ACCESSORY_NAME_MAX = 120;
const accessoryName = z.string().trim().min(1, 'Name is required').max(ACCESSORY_NAME_MAX, `At most ${ACCESSORY_NAME_MAX} characters`);
/** Upper-cased; '' or null → no SKU. */
const accessorySku = z
  .string()
  .trim()
  .max(40, 'At most 40 characters')
  .nullable()
  .transform((v) => (v ? v.toUpperCase() : null));
/** '' or null → no category. */
const accessoryCategory = z
  .string()
  .trim()
  .max(80, 'At most 80 characters')
  .nullable()
  .transform((v) => v || null);
const minStock = z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').max(100_000);

export const createAccessorySchema = z.object({
  name: accessoryName,
  sku: accessorySku.optional(),
  category: accessoryCategory.optional(),
  /** Selling price per piece (paise), charged when it is added to a booking. */
  sellPrice: paise.default(0),
  /** Low-stock alert level: an item is low when available ≤ minStock. */
  minStock: minStock.default(0),
  isPart: z.boolean().default(false),
});
export type CreateAccessoryInput = z.infer<typeof createAccessorySchema>;

/** Catalogue details only — stock and cost are not editable. At least one field. */
export const updateAccessorySchema = z
  .object({ name: accessoryName, sku: accessorySku, category: accessoryCategory, sellPrice: paise, minStock })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export type UpdateAccessoryInput = z.infer<typeof updateAccessorySchema>;

export const ACCESSORY_LIST_STATUSES = ['active', 'inactive', 'all'] as const;
export type AccessoryListStatus = (typeof ACCESSORY_LIST_STATUSES)[number];
export const listAccessoriesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  /** Active only by default — what the booking and quotation pickers offer. */
  status: z.enum(ACCESSORY_LIST_STATUSES).default('active'),
  /** Only items at or below their low-stock level. */
  lowStock: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  isPart: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type ListAccessoriesQuery = z.infer<typeof listAccessoriesQuerySchema>;

// ── Purchase (stock-in) ───────────────────────────────────
/*
 * Accessories bought from a vendor. Each line is the cost per piece before GST (as on the supplier bill) and
 * the GST — worked out from a rate, or typed when the bill differs. Stock goes up at once and the weighted-
 * average cost is recomputed from the cost before GST. A bill is paid now (method + date) or left unpaid (the
 * vendor's outstanding) and marked paid later. Purchase cost is the owner's: every purchase endpoint needs
 * inventory.cost. A wrong purchase is cancelled — only while its pieces are still in stock.
 */
export const ACCESSORY_PURCHASE_MAX_LINES = 100;
export const ACCESSORY_PURCHASE_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type AccessoryPurchaseStatus = (typeof ACCESSORY_PURCHASE_STATUSES)[number];
const payMethod = z.enum(FINANCE_PAY_METHODS as [FinancePayMethod, ...FinancePayMethod[]]);

export interface PurchaseLineFigures {
  taxable: bigint;
  gst: bigint;
  gstRateBp: number;
  lineTotal: bigint;
}

/**
 * One purchase line: taxable = cost per piece × quantity; GST = taxable × rate (half-up to the paisa) unless an
 * amount is typed, which then wins (rate recorded as 0). Shared by the API (which stores it) and the form.
 */
export function computePurchaseLine(unitCost: bigint, quantity: number, gst: { rateBp: number } | { amount: bigint }): PurchaseLineFigures {
  const taxable = unitCost * BigInt(quantity);
  const amount = 'amount' in gst ? gst.amount : (taxable * BigInt(gst.rateBp) * 2n + 10000n) / 20000n;
  return { taxable, gst: amount, gstRateBp: 'amount' in gst ? 0 : gst.rateBp, lineTotal: taxable + amount };
}

const purchaseItem = z.object({
  accessoryId: z.string().uuid('Choose an accessory'),
  quantity: z.coerce.number().int('Whole pieces only').min(1, 'At least 1').max(100_000),
  /** Cost per piece before GST (paise) — the weighted-average basis. */
  unitCost: paise,
  /** GST rate in percent (0–28), used when no GST amount is typed. */
  gstRate: z.coerce.number().min(0, 'Cannot be negative').max(28, 'At most 28%').optional(),
  /** GST amount for the whole line (paise), typed from the bill — wins over the rate. */
  gstAmount: paise.optional(),
  /** The purchase-order line these pieces are received against (needs `purchaseOrderId`). */
  purchaseOrderLineId: z.string().uuid().optional(),
});
export type AccessoryPurchaseItemInput = z.infer<typeof purchaseItem>;

const paymentSchema = z.object({
  method: payMethod,
  /** Defaults to the purchase date. */
  paidAt: z.coerce.date().optional(),
  reference: z.string().trim().max(120).optional(),
});

export const createAccessoryPurchaseSchema = z.object({
  vendorId: z.string().uuid().optional(),
  vendorInvoiceNumber: z.string().trim().max(60).optional(),
  /** The bill date (calendar date). Defaults to today; never in the future. */
  purchaseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(purchaseItem)
    .min(1, 'Add at least one accessory')
    .max(ACCESSORY_PURCHASE_MAX_LINES)
    .refine((lines) => new Set(lines.map((l) => l.accessoryId)).size === lines.length, { message: 'Each accessory once — change its quantity instead' }),
  /** Present = paid now; absent = unpaid (the vendor's outstanding). */
  payment: paymentSchema.optional(),
  /** Received against this purchase order: the vendor is the order's, and lines may name its accessory lines. */
  purchaseOrderId: z.string().uuid().optional(),
});
export type CreateAccessoryPurchaseInput = z.infer<typeof createAccessoryPurchaseSchema>;

export const markAccessoryPurchasePaidSchema = paymentSchema;
export type MarkAccessoryPurchasePaidInput = z.infer<typeof markAccessoryPurchasePaidSchema>;

export const cancelAccessoryPurchaseSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
});
export type CancelAccessoryPurchaseInput = z.infer<typeof cancelAccessoryPurchaseSchema>;

export const listAccessoryPurchasesQuerySchema = paginationQuerySchema.extend({
  vendorId: z.string().uuid().optional(),
  accessoryId: z.string().uuid().optional(),
  status: z.enum(ACCESSORY_PURCHASE_STATUSES).optional(),
  paid: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Purchase number, supplier bill number or vendor name. */
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAccessoryPurchasesQuery = z.infer<typeof listAccessoryPurchasesQuerySchema>;

// ── Opening stock & adjustments ───────────────────────────
/** Largest quantity one opening-stock entry or adjustment may move. */
export const ACCESSORY_STOCK_STEP_MAX = 100_000;

/**
 * Pieces already in the showroom when it starts using the system, with what each cost (ex-GST). It sets the
 * weighted-average cost, so it needs inventory.cost (the owner, by default). It can be entered (in one or more
 * lots) only until the item's first purchase, adjustment or booking; after that, stock changes go through those.
 */
export const openingStockSchema = z.object({
  quantity: z.coerce.number().int('Whole pieces only').min(1, 'At least 1').max(ACCESSORY_STOCK_STEP_MAX),
  /** Ex-GST unit cost (paise) that establishes the opening weighted-average. */
  unitCost: paise,
  note: z.string().trim().max(300).optional(),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

/**
 * A counted correction (damaged, lost, found, miscount). Signed: + adds pieces at the current average cost,
 * − removes them; the average cost is unchanged either way. Stock reserved for bookings cannot be adjusted away.
 */
export const stockAdjustmentSchema = z.object({
  delta: z.coerce
    .number()
    .int('Whole pieces only')
    .refine((n) => n !== 0, 'Adjustment cannot be zero')
    .refine((n) => Math.abs(n) <= ACCESSORY_STOCK_STEP_MAX, `At most ${ACCESSORY_STOCK_STEP_MAX} pieces at a time`),
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface AccessoryDto {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  sellPrice: string;
  /** Weighted-average cost per piece (system-maintained). Present only for users with inventory.cost. */
  avgCost?: string;
  onHand: number;
  reserved: number;
  /** onHand − reserved: what can still be put on a booking. */
  available: number;
  minStock: number;
  /** available ≤ minStock. */
  lowStock: boolean;
  isPart: boolean;
  isActive: boolean;
  /** GST classification (null = not classified). */
  taxClassificationId: string | null;
  createdAt: string;
  updatedAt: string;
}
/** One accessory with its latest stock movements (newest first). */
export interface AccessoryDetailDto extends AccessoryDto {
  movements: AccessoryMovementDto[];
  /** Opening stock can still be entered: nothing but opening stock has moved yet. */
  openingAllowed: boolean;
}
export interface AccessoryPurchaseItemDto {
  id: string;
  accessoryId: string;
  accessoryName: string;
  sku: string | null;
  quantity: number;
  /** Cost per piece before GST. */
  unitCost: string;
  gstRateBp: number;
  gstAmount: string;
  lineTotal: string;
}
export interface AccessoryPurchaseDto {
  id: string;
  purchaseNumber: string;
  vendorInvoiceNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  purchaseDate: string;
  notes: string | null;
  status: AccessoryPurchaseStatus;
  subtotal: string;
  gstAmount: string;
  total: string;
  paid: boolean;
  paidAt: string | null;
  paymentMethod: FinancePayMethod | null;
  paymentReference: string | null;
  /** Paid so far through vendor payments (part or all of the total). */
  allocated: string;
  /** The purchase order it was received against. */
  purchaseOrderId: string | null;
  poNumber: string | null;
  itemCount: number;
  /** "Helmet × 10, Guard × 5" — for lists. */
  itemsSummary: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  createdByName: string | null;
  createdAt: string;
}
export interface AccessoryPurchaseDetailDto extends AccessoryPurchaseDto {
  items: AccessoryPurchaseItemDto[];
}
export interface AccessoryMovementDto {
  id: string;
  accessoryId: string;
  type: AccessoryMovementType;
  quantity: number;
  /** Cost per piece at this movement — present only for users with inventory.cost. */
  unitCost?: string;
  onHandAfter: number;
  reservedAfter: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  /** Who recorded it (null for system movements). */
  createdByName: string | null;
  createdAt: string;
}
