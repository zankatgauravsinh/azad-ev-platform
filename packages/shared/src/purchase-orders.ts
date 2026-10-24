import { z } from 'zod';
import { paginationQuerySchema } from './pagination';

/* ── Purchase orders ───────────────────────────────────────────────────────────────────────────
 * An order placed with a vendor for scooters (a model / variant / colour) and accessories. It starts as a DRAFT,
 * is marked ORDERED when sent (the PO PDF goes to the vendor) and the vendor's proforma invoice (PI) and other
 * documents are attached to it. Scooters are received against a scooter line one by one (each becomes a scooter
 * in stock, bought from the PO's vendor at the line's price) and accessories as an accessory purchase. What was
 * received is counted from those records, so cancelling a purchase or deleting a scooter gives the quantity back.
 * A fully received order closes itself; one where the rest will not come is closed by hand. Prices are purchase
 * cost: purchase orders need inventory.cost besides vendors.view / vendors.manage.
 */
export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'ORDERED', 'CLOSED', 'CANCELLED'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  ORDERED: 'Ordered',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};
export const PURCHASE_ORDER_LINE_KINDS = ['SCOOTER', 'ACCESSORY'] as const;
export type PurchaseOrderLineKind = (typeof PURCHASE_ORDER_LINE_KINDS)[number];
export const PURCHASE_ORDER_DOCUMENT_TYPES = ['PROFORMA_INVOICE', 'INVOICE', 'DELIVERY_CHALLAN', 'OTHER'] as const;
export type PurchaseOrderDocumentType = (typeof PURCHASE_ORDER_DOCUMENT_TYPES)[number];
export const PURCHASE_ORDER_DOCUMENT_LABEL: Record<PurchaseOrderDocumentType, string> = {
  PROFORMA_INVOICE: 'Proforma invoice (PI)',
  INVOICE: 'Tax invoice',
  DELIVERY_CHALLAN: 'Delivery challan',
  OTHER: 'Other',
};
export const PURCHASE_ORDER_MAX_LINES = 100;
/** NONE: nothing received yet · PARTIAL: some lines or pieces still to come · FULL: everything received. */
export type PurchaseOrderReceipt = 'NONE' | 'PARTIAL' | 'FULL';

export interface PurchaseOrderLineDto {
  id: string;
  kind: PurchaseOrderLineKind;
  variantId: string | null;
  /** For a scooter line: model, variant and colour (to prefill the scooter form). */
  variant: { id: string; name: string; colour: string; model: { id: string; brand: string; name: string } } | null;
  accessoryId: string | null;
  accessoryName: string | null;
  description: string;
  quantity: number;
  received: number;
  /** Price per piece before GST. */
  unitCost: string;
  gstRateBp: number;
  gstAmount: string;
  lineTotal: string;
}

export interface PurchaseOrderDocumentDto {
  id: string;
  type: PurchaseOrderDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface PurchaseOrderDto {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  orderDate: string;
  expectedDate: string | null;
  status: PurchaseOrderStatus;
  receipt: PurchaseOrderReceipt;
  piNumber: string | null;
  piDate: string | null;
  notes: string | null;
  subtotal: string;
  gstAmount: string;
  total: string;
  orderedQty: number;
  receivedQty: number;
  /** Advances paid against this order (active vendor payments). */
  advancePaid: string;
  documentCount: number;
  cancelReason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PurchaseOrderReceivedUnitDto {
  id: string;
  lineId: string;
  vin: string;
  status: string;
  purchaseDate: string | null;
}
export interface PurchaseOrderReceivedPurchaseDto {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  vendorInvoiceNumber: string | null;
  total: string;
  status: string;
}

export interface PurchaseOrderDetailDto extends PurchaseOrderDto {
  lines: PurchaseOrderLineDto[];
  documents: PurchaseOrderDocumentDto[];
  units: PurchaseOrderReceivedUnitDto[];
  accessoryPurchases: PurchaseOrderReceivedPurchaseDto[];
  payments: { id: string; paymentNumber: string; paidAt: string; method: string; amount: string; status: string }[];
}

/**
 * One line's price: taxable = price before GST × quantity, GST = taxable × rate (half-up to the paisa). Shared by
 * the API and the form.
 */
export function computeOrderLine(unitCost: bigint, quantity: number, gstRateBp: number): { taxable: bigint; gst: bigint; lineTotal: bigint } {
  const taxable = unitCost * BigInt(quantity);
  const gst = (taxable * BigInt(gstRateBp) * 2n + 10000n) / 20000n;
  return { taxable, gst, lineTotal: taxable + gst };
}

const paise = z.coerce.number().int().min(0);

export const purchaseOrderLineInputSchema = z
  .object({
    /** An existing line (edit); omitted for a new one. */
    id: z.string().uuid().optional(),
    kind: z.enum(PURCHASE_ORDER_LINE_KINDS),
    variantId: z.string().uuid().optional(),
    accessoryId: z.string().uuid().optional(),
    /** Free text for the line (defaults to the item's name). */
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().int('Whole pieces only').min(1, 'At least 1').max(10_000),
    /** Price per piece before GST (paise). */
    unitCost: paise,
    /** GST rate in percent (0–28). */
    gstRate: z.coerce.number().min(0, 'Cannot be negative').max(28, 'At most 28%').default(0),
  })
  .refine((l) => (l.kind === 'SCOOTER' ? Boolean(l.variantId) : Boolean(l.accessoryId)), { message: 'Choose the scooter or accessory for each line' });
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

const orderFields = {
  vendorId: z.string().uuid('Choose a vendor'),
  /** Calendar date; defaults to today. */
  orderDate: z.coerce.date().optional(),
  expectedDate: z.coerce.date().nullable().optional(),
  piNumber: z.string().trim().max(60).nullable().optional(),
  piDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, 'Add at least one line').max(PURCHASE_ORDER_MAX_LINES),
};

export const createPurchaseOrderSchema = z.object(orderFields);
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/** Editing replaces the lines: lines sent with their id are kept (and changed), others are removed, new ones added. */
export const updatePurchaseOrderSchema = z.object({ ...orderFields, vendorId: orderFields.vendorId.optional(), lines: orderFields.lines.optional() });
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
});
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = paginationQuerySchema.extend({
  vendorId: z.string().uuid().optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  /** ORDERED orders with something still to receive. */
  pending: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

// ── Scooters already in stock, linked to an order line ──────────────────────────────────────────────────

/**
 * A scooter in stock that can belong to an order line: same model / variant, not on any order, its cost not already
 * in expenses, and bought from the order's vendor (or no vendor recorded). Money in paise.
 */
export interface StockCandidateDto {
  id: string;
  vin: string;
  status: string;
  addedOn: string;
  purchaseDate: string | null;
  vendorName: string | null;
  purchasePrice: string;
  purchaseGst: string;
  /** No purchase price or GST recorded: linking fills them from the order line. */
  costMissing: boolean;
  /** A purchase price is recorded and differs from the order line: linking keeps the scooter's own figure. */
  costDiffers: boolean;
}

export const linkStockSchema = z.object({
  unitIds: z.array(z.string().uuid()).min(1, 'Pick at least one scooter').max(500),
});
export type LinkStockInput = z.infer<typeof linkStockSchema>;
