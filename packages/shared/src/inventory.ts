import { z } from 'zod';
import { UnitStatus, UNIT_STATUSES, DocumentType, DOCUMENT_TYPES } from './enums';
import { paginationQuerySchema } from './pagination';

/** A non-negative integer amount of paise (₹ × 100). */
const paise = z.coerce.number().int().min(0);
const optionalTrimmed = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const vinField = z
  .string()
  .trim()
  .min(3, 'Too short')
  .max(64)
  .transform((v) => v.toUpperCase());

const identifierField = z.string().trim().min(1).max(64).transform((v) => v.toUpperCase());

export const createUnitSchema = z.object({
  modelId: z.string().uuid('Select a model'),
  variant: z.string().trim().min(1, 'Variant is required').max(80),
  colour: z.string().trim().min(1, 'Colour is required').max(60),
  hexColour: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Use a #RRGGBB hex colour')
    .optional(),
  vin: vinField,
  motorNumber: identifierField,
  batteryNumber: identifierField,
  purchaseDate: z.coerce.date().optional(),
  purchaseCost: paise.default(0),
  sellingPrice: paise.default(0),
  supplier: optionalTrimmed,
  location: optionalTrimmed,
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]).default(UnitStatus.AVAILABLE),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema
  .omit({ status: true })
  .partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const changeUnitStatusSchema = z.object({
  toStatus: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]),
  note: z.string().trim().max(500).optional(),
});
export type ChangeUnitStatusInput = z.infer<typeof changeUnitStatusSchema>;

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]).optional(),
  modelId: z.string().uuid().optional(),
  supplier: z.string().trim().optional(),
  sort: z
    .enum(['createdAt', 'vin', 'status', 'sellingPrice', 'purchaseDate'])
    .default('createdAt'),
});
export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;

/** One row of a bulk CSV import (values arrive as strings; rupees, not paise). */
export const csvUnitRowSchema = z.object({
  model: z.string().trim().min(1),
  variant: z.string().trim().min(1),
  colour: z.string().trim().min(1),
  vin: vinField,
  motorNumber: identifierField,
  batteryNumber: identifierField,
  purchaseDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  purchaseCost: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  supplier: z.string().trim().optional(),
  location: z.string().trim().optional(),
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
});
export type CsvUnitRow = z.infer<typeof csvUnitRowSchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface InventoryModelRef {
  id: string;
  name: string;
  brand: string;
}
export interface InventoryVariantRef {
  id: string;
  name: string;
  colour: string;
  hexColour: string | null;
  model: InventoryModelRef;
}
export interface InventoryUnitDto {
  id: string;
  vin: string;
  motorNumber: string;
  batteryNumber: string;
  status: UnitStatus;
  purchaseDate: string | null;
  purchaseCost: string;
  sellingPrice: string;
  supplier: string | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  variant: InventoryVariantRef;
}
export interface InventoryEventDto {
  id: string;
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus;
  note: string | null;
  createdAt: string;
  createdById: string | null;
}
export interface InventoryStats {
  total: number;
  available: number;
  reserved: number;
  booked: number;
  delivered: number;
  inService: number;
  returned: number;
}
export interface InventoryUnitPhotoDto {
  id: string;
  fileKey: string;
  url: string;
  label: string | null;
  createdAt: string;
}
export interface InventoryUnitDocumentDto {
  id: string;
  type: DocumentType;
  fileKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface CsvImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export const inventoryDocumentTypes = DOCUMENT_TYPES;
