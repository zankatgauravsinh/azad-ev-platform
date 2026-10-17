import { z } from 'zod';
import { AccessoryMovementType } from './enums';
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
const purchaseItem = z.object({
  accessoryId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1),
  /** Ex-GST unit cost (paise) — the weighted-average basis. */
  unitCost: paise,
  gstAmount: paise.default(0),
});
export type AccessoryPurchaseItemInput = z.infer<typeof purchaseItem>;

export const createAccessoryPurchaseSchema = z.object({
  vendorId: z.string().uuid().optional(),
  purchaseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(purchaseItem).min(1),
});
export type CreateAccessoryPurchaseInput = z.infer<typeof createAccessoryPurchaseSchema>;

export const listAccessoryPurchasesQuerySchema = paginationQuerySchema.extend({
  vendorId: z.string().uuid().optional(),
  accessoryId: z.string().uuid().optional(),
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
  quantity: number;
  unitCost: string;
  gstAmount: string;
  lineTotal: string;
}
export interface AccessoryPurchaseDto {
  id: string;
  purchaseNumber: string;
  vendorId: string | null;
  vendorName: string | null;
  purchaseDate: string;
  notes: string | null;
  subtotal: string;
  gstAmount: string;
  total: string;
  items: AccessoryPurchaseItemDto[];
  createdAt: string;
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
