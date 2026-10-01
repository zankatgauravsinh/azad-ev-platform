import { z } from 'zod';
import { AccessoryMovementType } from './enums';
import { paginationQuerySchema } from './pagination';

const paise = z.coerce.number().int().min(0);

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
export const openingStockSchema = z.object({
  quantity: z.coerce.number().int().min(1),
  /** Ex-GST unit cost (paise) that establishes the opening weighted-average. */
  unitCost: paise,
  reason: z.string().trim().min(1).max(300),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

export const stockAdjustmentSchema = z.object({
  /** Signed change to onHand (may be negative; cannot take available below zero). */
  delta: z.coerce.number().int().refine((n) => n !== 0, 'Adjustment cannot be zero'),
  reason: z.string().trim().min(1).max(300),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// ── Response DTOs ─────────────────────────────────────────
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
  unitCost: string;
  onHandAfter: number;
  reservedAfter: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}
