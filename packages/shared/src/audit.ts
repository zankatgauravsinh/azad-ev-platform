import { z } from 'zod';
import { ACTIVITY_ACTIONS, AUDIT_SOURCES, type ActivityAction, type AuditSource } from './enums';

/*
 * The audit log: who did what, when, from where, and what changed. Read on the Audit Log screen (audit.view)
 * and, for one record, in its History panel (that record's own view permission).
 */

const actionTuple = ACTIVITY_ACTIONS as [ActivityAction, ...ActivityAction[]];
const sourceTuple = AUDIT_SOURCES as [AuditSource, ...AuditSource[]];
const optionalText = z.string().trim().max(120).optional().transform((v) => (v ? v : undefined));

/** Filters shared by the list and the export. Dates are inclusive calendar days in the company's time zone. */
const auditFilters = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  actorId: z.string().uuid().optional(),
  action: z.enum(actionTuple).optional(),
  source: z.enum(sourceTuple).optional(),
  /** A record type (e.g. Booking) — its automatic entries (route "bookings") are included. */
  entityType: optionalText,
  entityId: z.string().uuid().optional(),
  /** Searches the summary, the record label and the person's name. */
  q: optionalText,
};

export const listAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  ...auditFilters,
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const AUDIT_EXPORT_FORMATS = ['xlsx', 'pdf', 'csv'] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];
/** The most rows one export carries (newest first); narrow the filters for more. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

export const exportAuditQuerySchema = z.object({ format: z.enum(AUDIT_EXPORT_FORMATS).default('xlsx'), ...auditFilters });
export type ExportAuditQuery = z.infer<typeof exportAuditQuerySchema>;

/** One record's history. */
export const auditHistoryQuerySchema = z.object({
  entityType: z.string().trim().min(1).max(60),
  entityId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;

export type AuditValue = string | number | boolean | null;

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  action: ActivityAction;
  source: AuditSource;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  /** { field: { from, to } } — purchase-cost fields only for viewers with inventory.cost. */
  changes: Record<string, { from: AuditValue; to: AuditValue }> | null;
  metadata: unknown;
  reason: string | null;
  actor: { id: string | null; name: string | null; role: string | null } | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Choices for the screen's filters: the people and record types that appear in this company's log. */
export interface AuditFacetsDto {
  actors: { id: string; name: string }[];
  entityTypes: string[];
}

/**
 * A record type and the route segment its automatic (AUTO) entries are filed under, the label people see, and
 * the permission that lets someone read that record's History panel (audit.view always can).
 */
export const AUDIT_ENTITY_TYPES: Record<string, { label: string; route?: string; viewPermission?: string }> = {
  Customer: { label: 'Customer', route: 'customers', viewPermission: 'customers.view' },
  CustomerNote: { label: 'Customer note', viewPermission: 'customers.view' },
  CustomerDocument: { label: 'Customer document', viewPermission: 'customers.view' },
  CustomerFollowUp: { label: 'Follow-up', viewPermission: 'customers.view' },
  Quotation: { label: 'Quotation', route: 'quotations', viewPermission: 'quotations.view' },
  Booking: { label: 'Booking', route: 'bookings', viewPermission: 'bookings.view' },
  Sale: { label: 'Invoice', viewPermission: 'bookings.view' },
  Payment: { label: 'Payment', viewPermission: 'bookings.view' },
  Delivery: { label: 'Delivery', route: 'deliveries', viewPermission: 'delivery.view' },
  RtoInvoice: { label: 'RTO invoice', route: 'rto-invoices', viewPermission: 'rto.view' },
  VehicleReturn: { label: 'Return', route: 'returns', viewPermission: 'returns.view' },
  InventoryUnit: { label: 'Scooter', route: 'inventory', viewPermission: 'inventory.view' },
  ScooterModel: { label: 'Scooter model', viewPermission: 'inventory.view' },
  ScooterVariant: { label: 'Scooter variant', viewPermission: 'inventory.view' },
  Accessory: { label: 'Accessory', route: 'accessories', viewPermission: 'accessories.view' },
  AccessoryPurchase: { label: 'Accessory purchase', route: 'accessory-purchases', viewPermission: 'accessories.manage' },
  AccessorySale: { label: 'Accessory sale', route: 'accessory-sales', viewPermission: 'accessories.view' },
  ServiceJob: { label: 'Service job', route: 'service', viewPermission: 'service.view' },
  SparePart: { label: 'Spare part', viewPermission: 'spareparts.view' },
  LabourItem: { label: 'Labour item', viewPermission: 'labour.view' },
  Warranty: { label: 'Warranty', route: 'warranties', viewPermission: 'warranty.view' },
  FreeService: { label: 'Free service', viewPermission: 'warranty.view' },
  WarrantyClaim: { label: 'Warranty claim', route: 'warranty-claims', viewPermission: 'claims.view' },
  AmcPlan: { label: 'AMC plan', route: 'amc', viewPermission: 'amc.view' },
  Vendor: { label: 'Vendor', route: 'vendors', viewPermission: 'vendors.view' },
  VendorPayment: { label: 'Vendor payment', route: 'vendor-payments', viewPermission: 'vendors.view' },
  PurchaseOrder: { label: 'Purchase order', route: 'purchase-orders', viewPermission: 'vendors.view' },
  Expense: { label: 'Expense', route: 'expenses', viewPermission: 'expenses.view' },
  ExpenseCategory: { label: 'Expense category', viewPermission: 'expenses.view' },
  RecurringExpense: { label: 'Recurring expense', viewPermission: 'expenses.view' },
  Income: { label: 'Income', route: 'income', viewPermission: 'income.view' },
  BankTransaction: { label: 'Bank transaction', route: 'bank-transactions', viewPermission: 'bank.view' },
  CashBook: { label: 'Cash book', route: 'finance', viewPermission: 'finance.view' },
  CashAdjustment: { label: 'Cash adjustment', viewPermission: 'finance.view' },
  MonthlyClosing: { label: 'Monthly closing', viewPermission: 'finance.view' },
  DocumentShareLink: { label: 'WhatsApp share', route: 'share-links' },
  CompanySetting: { label: 'Company settings', route: 'settings', viewPermission: 'settings.view' },
  TaxClassification: { label: 'GST classification', route: 'tax', viewPermission: 'settings.view' },
  TaxComponentMapping: { label: 'GST mapping', viewPermission: 'settings.view' },
  User: { label: 'User', route: 'users', viewPermission: 'staff.manage' },
  Role: { label: 'Role', route: 'roles', viewPermission: 'roles.manage' },
  AuditLog: { label: 'Audit log' },
};

const ROUTE_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(AUDIT_ENTITY_TYPES).filter((t) => t.route).map((t) => [t.route!, t.label]),
);

/** "Booking", "Scooter"… for a stored entity type or automatic-entry route segment. */
export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPES[entityType]?.label ?? ROUTE_LABEL[entityType] ?? entityType.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The stored entity types a filter on `entityType` matches: the type itself and its automatic-entry route. */
export function auditEntityTypesFor(entityType: string): string[] {
  const route = AUDIT_ENTITY_TYPES[entityType]?.route;
  return route ? [entityType, route] : [entityType];
}

export const AUDIT_ACTION_LABEL: Record<ActivityAction, string> = {
  CREATE: 'Created',
  UPDATE: 'Changed',
  DELETE: 'Deleted',
  STATUS_CHANGE: 'Status changed',
  LOGIN: 'Signed in',
  PAYMENT: 'Payment',
  EXPORT: 'Exported / shared',
  LOGIN_FAILED: 'Sign-in refused',
  LOGOUT: 'Signed out',
  DOWNLOAD: 'Downloaded',
  SHARE_OPEN: 'Link opened',
  CANCEL: 'Cancelled',
  APPROVE: 'Approved',
};

export const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  USER: 'Person',
  SYSTEM: 'System',
  PUBLIC: 'Customer link',
  AUTO: 'Automatic record',
};
