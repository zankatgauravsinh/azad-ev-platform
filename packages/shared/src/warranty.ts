import { z } from 'zod';
import {
  WARRANTY_STATUSES,
  WARRANTY_CLAIM_STATUSES,
  FREE_SERVICE_STATUSES,
  AMC_PLAN_TYPES,
  AMC_STATUSES,
  WARRANTY_COVERAGE_ITEMS,
  type WarrantyStatus,
  type WarrantyClaimStatus,
  type FreeServiceStatus,
  type AmcPlanType,
  type AmcStatus,
  type WarrantyCoverageItem,
} from './enums';

const paise = z.coerce.number().int().min(0);
const warrantyStatusTuple = WARRANTY_STATUSES as [WarrantyStatus, ...WarrantyStatus[]];
const claimStatusTuple = WARRANTY_CLAIM_STATUSES as [WarrantyClaimStatus, ...WarrantyClaimStatus[]];
const amcPlanTuple = AMC_PLAN_TYPES as [AmcPlanType, ...AmcPlanType[]];
const coverageItemTuple = WARRANTY_COVERAGE_ITEMS as [WarrantyCoverageItem, ...WarrantyCoverageItem[]];

/* ------------------------------------------------------------------ *
 * DTOs
 * ------------------------------------------------------------------ */

export interface WarrantyCoverageLine {
  item: WarrantyCoverageItem;
  label: string;
  covered: boolean;
  remarks: string | null;
}

export interface WarrantyPartLine {
  name: string;
  quantity: number;
}

export interface WarrantyRecordDto {
  id: string;
  warrantyNumber: string;
  status: WarrantyStatus;
  customerId: string;
  customerName: string;
  unitId: string;
  vin: string;
  model: string;
  variant: string;
  motorNumber: string | null;
  batteryNumber: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  saleId: string | null;
  invoiceNumber: string | null;
  purchaseDate: string;
  startDate: string;
  endDate: string;
  periodMonths: number;
  daysToExpiry: number;
  dealerNotes: string | null;
  customerNotes: string | null;
  createdAt: string;
}

export interface FreeServiceDto {
  id: string;
  serviceNumber: number;
  status: FreeServiceStatus;
  dueDate: string;
  completedDate: string | null;
  technicianId: string | null;
  technicianName: string | null;
  remarks: string | null;
}

export interface WarrantyClaimDto {
  id: string;
  claimNumber: string;
  warrantyId: string;
  warrantyNumber: string;
  status: WarrantyClaimStatus;
  customerName: string;
  vin: string;
  complaint: string;
  diagnosis: string | null;
  partsReplaced: WarrantyPartLine[];
  labour: string | null;
  claimDate: string;
  completionDate: string | null;
  claimCost: string;
  manufacturerClaimAmount: string;
  dealerCost: string;
  technicianId: string | null;
  technicianName: string | null;
  createdAt: string;
}

export interface AmcVisitDto {
  id: string;
  amcPlanId: string;
  visitNumber: number;
  visitDate: string;
  technicianId: string | null;
  technicianName: string | null;
  workDone: string;
  partsUsed: string | null;
  amount: string;
  coveredUnderAmc: boolean;
}

export interface AmcPlanDto {
  id: string;
  amcNumber: string;
  status: AmcStatus;
  planType: AmcPlanType;
  customerId: string;
  customerName: string;
  unitId: string;
  vin: string;
  model: string;
  startDate: string;
  endDate: string;
  visitsIncluded: number;
  visitsUsed: number;
  visitsRemaining: number;
  price: string;
  daysToExpiry: number;
  notes: string | null;
  createdAt: string;
}

export interface AmcPlanDetailDto extends AmcPlanDto {
  visits: AmcVisitDto[];
}

export interface WarrantyTimelineEntry {
  at: string;
  kind:
    | 'PURCHASED'
    | 'WARRANTY_ACTIVATED'
    | 'FREE_SERVICE'
    | 'SERVICE'
    | 'CLAIM'
    | 'AMC_PURCHASED'
    | 'AMC_VISIT'
    | 'WARRANTY_EXPIRY';
  title: string;
  detail: string | null;
}

export interface WarrantyDetailDto {
  warranty: WarrantyRecordDto;
  coverage: WarrantyCoverageLine[];
  freeServices: FreeServiceDto[];
  claims: WarrantyClaimDto[];
  amc: AmcPlanDto[];
  timeline: WarrantyTimelineEntry[];
}

export interface WarrantyDashboardDto {
  warranty: {
    active: number;
    expiring90: number;
    expiring30: number;
    expired: number;
    claimsPending: number;
    claimsApproved: number;
    claimsRejected: number;
    freeServicesDue: number;
  };
  amc: {
    active: number;
    expired: number;
    expiring30: number;
    revenue: string;
    upcomingVisits: number;
    visitsUsed: number;
  };
}

/* ------------------------------------------------------------------ *
 * Input schemas
 * ------------------------------------------------------------------ */

const coverageLineSchema = z.object({
  item: z.enum(coverageItemTuple),
  label: z.string().trim().max(80).optional(),
  covered: z.boolean(),
  remarks: z.string().trim().max(200).nullish(),
});

export const createWarrantySchema = z.object({
  unitId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
  purchaseDate: z.coerce.date().optional(),
  periodMonths: z.coerce.number().int().min(1).max(240).optional(),
  motorNumber: z.string().trim().max(60).optional(),
  batteryNumber: z.string().trim().max(60).optional(),
  coverage: z.array(coverageLineSchema).optional(),
  dealerNotes: z.string().trim().max(1000).optional(),
  customerNotes: z.string().trim().max(1000).optional(),
});
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>;

export const updateWarrantySchema = z.object({
  coverage: z.array(coverageLineSchema).optional(),
  dealerNotes: z.string().trim().max(1000).nullish(),
  customerNotes: z.string().trim().max(1000).nullish(),
  status: z.enum(warrantyStatusTuple).optional(),
});
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>;

export const listWarrantiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(warrantyStatusTuple).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type ListWarrantiesQuery = z.infer<typeof listWarrantiesQuerySchema>;

const partLineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(999),
});

export const createWarrantyClaimSchema = z.object({
  warrantyId: z.string().uuid(),
  complaint: z.string().trim().min(1, 'Complaint is required').max(1000),
  diagnosis: z.string().trim().max(1000).optional(),
  partsReplaced: z.array(partLineSchema).max(50).optional(),
  labour: z.string().trim().max(500).optional(),
  claimDate: z.coerce.date().optional(),
  claimCost: paise.default(0),
  manufacturerClaimAmount: paise.default(0),
  technicianId: z.string().uuid().optional(),
});
export type CreateWarrantyClaimInput = z.infer<typeof createWarrantyClaimSchema>;

export const updateClaimStatusSchema = z.object({
  status: z.enum(claimStatusTuple),
  diagnosis: z.string().trim().max(1000).optional(),
  claimCost: paise.optional(),
  manufacturerClaimAmount: paise.optional(),
  note: z.string().trim().max(500).optional(),
});
export type UpdateClaimStatusInput = z.infer<typeof updateClaimStatusSchema>;

export const listClaimsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(claimStatusTuple).optional(),
  warrantyId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListClaimsQuery = z.infer<typeof listClaimsQuerySchema>;

export const completeFreeServiceSchema = z.object({
  status: z.enum(FREE_SERVICE_STATUSES as [FreeServiceStatus, ...FreeServiceStatus[]]).default('COMPLETED'),
  completedDate: z.coerce.date().optional(),
  technicianId: z.string().uuid().optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CompleteFreeServiceInput = z.infer<typeof completeFreeServiceSchema>;

export const createAmcSchema = z.object({
  unitId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  planType: z.enum(amcPlanTuple).default('SILVER'),
  startDate: z.coerce.date().optional(),
  months: z.coerce.number().int().min(1).max(60).default(12),
  visitsIncluded: z.coerce.number().int().min(1).max(52).default(3),
  price: paise.refine((v) => v >= 0, 'Price must be zero or more'),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateAmcInput = z.infer<typeof createAmcSchema>;

export const listAmcQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(AMC_STATUSES as [AmcStatus, ...AmcStatus[]]).optional(),
  planType: z.enum(amcPlanTuple).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListAmcQuery = z.infer<typeof listAmcQuerySchema>;

export const createAmcVisitSchema = z.object({
  visitDate: z.coerce.date().optional(),
  technicianId: z.string().uuid().optional(),
  workDone: z.string().trim().min(1, 'Work done is required').max(1000),
  partsUsed: z.string().trim().max(500).optional(),
  amount: paise.default(0),
  coveredUnderAmc: z.boolean().default(true),
});
export type CreateAmcVisitInput = z.infer<typeof createAmcVisitSchema>;
