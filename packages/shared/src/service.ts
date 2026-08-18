import { z } from 'zod';
import {
  InspectionResult,
  PaymentMode,
  PaymentStatus,
  ServiceJobType,
  ServicePriority,
  ServiceStatus,
  INSPECTION_ITEMS,
  INSPECTION_RESULTS,
  PAYMENT_MODES,
  SERVICE_JOB_TYPES,
  SERVICE_PRIORITIES,
  SERVICE_STATUSES,
} from './enums';
import { paginationQuerySchema } from './pagination';

const paise = z.coerce.number().int().min(0);
const money = paise.default(0);

// ─────────────────────────── Job cards ───────────────────────────

export const complaintInputSchema = z.object({
  description: z.string().trim().min(1, 'Describe the complaint').max(500),
  priority: z.enum(SERVICE_PRIORITIES as [ServicePriority, ...ServicePriority[]]).default(ServicePriority.MEDIUM),
});
export type ComplaintInput = z.infer<typeof complaintInputSchema>;

export const createServiceJobSchema = z.object({
  customerId: z.string().uuid(),
  unitId: z.string().uuid(),
  bookingId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
  type: z.enum(SERVICE_JOB_TYPES as [ServiceJobType, ...ServiceJobType[]]),
  priority: z.enum(SERVICE_PRIORITIES as [ServicePriority, ...ServicePriority[]]).default(ServicePriority.MEDIUM),
  odometerKm: z.coerce.number().int().min(0).optional(),
  scheduledDate: z.coerce.date().optional(),
  expectedDelivery: z.coerce.date().optional(),
  technicianId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  complaints: z.array(complaintInputSchema).min(1, 'At least one complaint is required'),
});
export type CreateServiceJobInput = z.infer<typeof createServiceJobSchema>;

export const updateServiceJobSchema = z.object({
  priority: z.enum(SERVICE_PRIORITIES as [ServicePriority, ...ServicePriority[]]).optional(),
  odometerKm: z.coerce.number().int().min(0).optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  expectedDelivery: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateServiceJobInput = z.infer<typeof updateServiceJobSchema>;

export const changeServiceStatusSchema = z.object({
  status: z.enum(SERVICE_STATUSES as [ServiceStatus, ...ServiceStatus[]]),
});
export type ChangeServiceStatusInput = z.infer<typeof changeServiceStatusSchema>;

export const assignTechnicianSchema = z.object({
  technicianId: z.string().uuid().nullable(),
});
export type AssignTechnicianInput = z.infer<typeof assignTechnicianSchema>;

export const addComplaintSchema = complaintInputSchema;
export type AddComplaintInput = z.infer<typeof addComplaintSchema>;

// ─────────────────────────── Inspection ───────────────────────────

export const inspectionItemSchema = z.object({
  item: z.enum(INSPECTION_ITEMS as unknown as [string, ...string[]]),
  result: z.enum(INSPECTION_RESULTS as [InspectionResult, ...InspectionResult[]]),
  notes: z.string().trim().max(300).optional(),
});
export const saveInspectionSchema = z.object({
  items: z.array(inspectionItemSchema).min(1),
});
export type SaveInspectionInput = z.infer<typeof saveInspectionSchema>;

// ─────────────────────────── Parts & labour on a job ───────────────────────────

export const addServicePartSchema = z
  .object({
    sparePartId: z.string().uuid().optional(),
    name: z.string().trim().max(160).optional(),
    qty: z.coerce.number().int().min(1).default(1),
    unitCost: money,
    unitPrice: money,
    warranty: z.boolean().default(false),
  })
  .refine((v) => v.sparePartId || v.name, { message: 'Provide a spare part or a name', path: ['name'] });
export type AddServicePartInput = z.infer<typeof addServicePartSchema>;

export const addServiceLabourSchema = z
  .object({
    labourItemId: z.string().uuid().optional(),
    description: z.string().trim().max(200).optional(),
    cost: money,
  })
  .refine((v) => v.labourItemId || v.description, { message: 'Provide a labour item or a description', path: ['description'] });
export type AddServiceLabourInput = z.infer<typeof addServiceLabourSchema>;

export const serviceBillSchema = z.object({
  discount: money,
  taxPercentage: z.coerce.number().min(0).max(100).default(0),
});
export type ServiceBillInput = z.infer<typeof serviceBillSchema>;

export const serviceFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  note: z.string().trim().max(1000).optional(),
});
export type ServiceFeedbackInput = z.infer<typeof serviceFeedbackSchema>;

export const servicePaymentSchema = z.object({
  amount: paise.refine((v) => v > 0, 'Amount must be greater than zero'),
  mode: z.enum(PAYMENT_MODES as [PaymentMode, ...PaymentMode[]]).default(PaymentMode.CASH),
  reference: z.string().trim().max(120).optional(),
});
export type ServicePaymentInput = z.infer<typeof servicePaymentSchema>;

export const listServiceJobsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  status: z.enum(SERVICE_STATUSES as [ServiceStatus, ...ServiceStatus[]]).optional(),
  type: z.enum(SERVICE_JOB_TYPES as [ServiceJobType, ...ServiceJobType[]]).optional(),
  technicianId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'code', 'status', 'scheduledDate', 'priority']).default('createdAt'),
});
export type ListServiceJobsQuery = z.infer<typeof listServiceJobsQuerySchema>;

// ─────────────────────────── Spare parts catalogue ───────────────────────────

export const createSparePartSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(60),
  quantity: z.coerce.number().int().min(0).default(0),
  cost: money,
  sellingPrice: money,
  warrantyMonths: z.coerce.number().int().min(0).max(120).default(0),
  minStock: z.coerce.number().int().min(0).default(0),
});
export type CreateSparePartInput = z.infer<typeof createSparePartSchema>;

export const updateSparePartSchema = createSparePartSchema.partial();
export type UpdateSparePartInput = z.infer<typeof updateSparePartSchema>;

export const adjustStockSchema = z.object({
  delta: z.coerce.number().int(),
  reason: z.string().trim().max(200).optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const listSparePartsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  lowStock: z.coerce.boolean().optional(),
  sort: z.enum(['name', 'sku', 'quantity', 'createdAt']).default('name'),
});
export type ListSparePartsQuery = z.infer<typeof listSparePartsQuerySchema>;

// ─────────────────────────── Labour catalogue ───────────────────────────

export const createLabourItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  defaultCost: money,
  durationMins: z.coerce.number().int().min(0).default(0),
});
export type CreateLabourItemInput = z.infer<typeof createLabourItemSchema>;

export const updateLabourItemSchema = createLabourItemSchema.partial();
export type UpdateLabourItemInput = z.infer<typeof updateLabourItemSchema>;

// ─────────────────────────── DTOs ───────────────────────────

export interface ServiceComplaintDto {
  id: string;
  description: string;
  priority: ServicePriority;
  resolved: boolean;
}
export interface ServiceInspectionItemDto {
  id: string;
  item: string;
  result: InspectionResult;
  notes: string | null;
}
export interface ServicePartDto {
  id: string;
  sparePartId: string | null;
  name: string;
  qty: number;
  unitCost: string;
  unitPrice: string;
  warranty: boolean;
  lineTotal: string;
}
export interface ServiceLabourDto {
  id: string;
  labourItemId: string | null;
  description: string;
  cost: string;
}
export interface ServiceBillDto {
  partsTotal: string;
  labourTotal: string;
  discount: string;
  taxAmount: string;
  total: string;
  paid: string;
  balance: string;
  status: PaymentStatus;
}
export interface WarrantyStatusDto {
  vehicle: { months: number; startDate: string | null; endDate: string | null; active: boolean; daysRemaining: number };
}
export interface ServiceJobDto {
  id: string;
  code: string;
  type: ServiceJobType;
  priority: ServicePriority;
  status: ServiceStatus;
  underWarranty: boolean;
  odometerKm: number | null;
  scheduledDate: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  expectedDelivery: string | null;
  actualDelivery: string | null;
  notes: string | null;
  feedbackRating: number | null;
  feedbackNote: string | null;
  customer: { id: string; name: string; phone: string };
  unit: { id: string; vin: string; model: string; variant: string; colour: string };
  technician: { id: string; name: string } | null;
  complaints: ServiceComplaintDto[];
  inspection: ServiceInspectionItemDto[];
  parts: ServicePartDto[];
  labour: ServiceLabourDto[];
  bill: ServiceBillDto;
  warrantyStatus: WarrantyStatusDto;
  createdAt: string;
}
export interface SparePartDto {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  cost: string;
  sellingPrice: string;
  warrantyMonths: number;
  minStock: number;
  lowStock: boolean;
}
export interface LabourItemDto {
  id: string;
  name: string;
  defaultCost: string;
  durationMins: number;
}

// ─────────────────────────── Reports ───────────────────────────

export interface DailyServiceReport {
  date: string;
  created: number;
  delivered: number;
  collected: string;
  byStatus: { status: ServiceStatus; count: number }[];
}
export interface TechnicianPerformanceRow {
  technicianId: string;
  name: string;
  totalJobs: number;
  delivered: number;
  revenue: string;
  avgRating: number | null;
}
export interface ServiceRevenueReport {
  billed: string;
  collected: string;
  partsRevenue: string;
  labourRevenue: string;
  jobs: number;
}
export interface WarrantyClaimsReport {
  warrantyJobs: number;
  warrantyParts: number;
  recent: { code: string; customer: string; createdAt: string }[];
}
export interface CountRow {
  label: string;
  count: number;
}
export interface TopPartRow {
  name: string;
  qty: number;
}
export interface ServiceReports {
  daily: DailyServiceReport;
  technicians: TechnicianPerformanceRow[];
  revenue: ServiceRevenueReport;
  warranty: WarrantyClaimsReport;
  repeatComplaints: CountRow[];
  topReplacedParts: TopPartRow[];
}
