import { z } from 'zod';
import {
  CustomerEventType,
  FollowUpPriority,
  FollowUpStatus,
  Gender,
  LeadStatus,
  LEAD_STATUSES,
  GENDERS,
  FOLLOW_UP_PRIORITIES,
  MANUAL_CUSTOMER_EVENTS,
  DocumentType,
} from './enums';
import { paginationQuerySchema } from './pagination';

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+91/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[\s-]/g, '').replace(/^\+91/, '') : undefined))
  .refine((v) => v === undefined || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  altPhone: optionalPhone,
  email: z.string().trim().email().optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  address: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'PIN must be 6 digits')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  village: optionalText(80),
  occupation: optionalText(80),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(GENDERS as [Gender, ...Gender[]]).optional(),
  leadStatus: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]).default(LeadStatus.NEW),
  source: optionalText(80),
  preferredModelId: z.string().uuid().optional(),
  preferredColour: optionalText(60),
  preferredFinanceOption: optionalText(80),
  assignedToId: z.string().uuid().optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().omit({ leadStatus: true });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  leadStatus: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]).optional(),
  assignedToId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'name', 'leadStatus', 'updatedAt']).default('createdAt'),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export const changeLeadStatusSchema = z
  .object({
    leadStatus: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]),
    lostReason: optionalText(300),
  })
  .refine((v) => v.leadStatus !== LeadStatus.LOST || (v.lostReason && v.lostReason.length > 0), {
    message: 'A reason is required when marking a lead as Lost',
    path: ['lostReason'],
  });
export type ChangeLeadStatusInput = z.infer<typeof changeLeadStatusSchema>;

export const logInteractionSchema = z.object({
  type: z.enum(MANUAL_CUSTOMER_EVENTS as unknown as [CustomerEventType, ...CustomerEventType[]]),
  note: z.string().trim().max(1000).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type LogInteractionInput = z.infer<typeof logInteractionSchema>;

export const createNoteSchema = z.object({ body: z.string().trim().min(1, 'Note cannot be empty').max(2000) });
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export const updateNoteSchema = createNoteSchema;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const createFollowUpSchema = z.object({
  dueAt: z.coerce.date(),
  priority: z.enum(FOLLOW_UP_PRIORITIES as [FollowUpPriority, ...FollowUpPriority[]]).default(FollowUpPriority.MEDIUM),
  note: z.string().trim().max(500).optional(),
  remindBeforeMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  assignedToId: z.string().uuid().optional(),
});
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const updateFollowUpSchema = createFollowUpSchema.partial();
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;

export const timelineQuerySchema = z.object({
  type: z.string().optional(),
});

// ── Response DTOs ─────────────────────────────────────────
export interface ModelRef {
  id: string;
  name: string;
  brand: string;
}
export interface UserRef {
  id: string;
  name: string;
  role: string;
}
export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  village: string | null;
  occupation: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  leadStatus: LeadStatus;
  source: string | null;
  lostReason: string | null;
  preferredModel: ModelRef | null;
  preferredColour: string | null;
  preferredFinanceOption: string | null;
  assignedTo: UserRef | null;
  createdAt: string;
  updatedAt: string;
}
export interface CustomerListItem extends CustomerDto {
  counts: { bookings: number; sales: number; followUpsPending: number };
}
export interface CustomerTimelineEntryDto {
  id: string;
  type: CustomerEventType;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
  createdById: string | null;
}
export interface CustomerFollowUpDto {
  id: string;
  dueAt: string;
  priority: FollowUpPriority;
  note: string | null;
  remindBeforeMinutes: number | null;
  status: FollowUpStatus;
  completedAt: string | null;
  assignedTo: UserRef | null;
  isOverdue: boolean;
  createdAt: string;
}
export interface CustomerNoteRevisionDto {
  id: string;
  body: string;
  editedById: string | null;
  createdAt: string;
}
export interface CustomerNoteDto {
  id: string;
  body: string;
  editCount: number;
  author: UserRef | null;
  createdAt: string;
  updatedAt: string;
  revisions?: CustomerNoteRevisionDto[];
}
export interface CustomerDocumentDto {
  id: string;
  type: DocumentType;
  fileKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface WarrantyDto {
  unitId: string;
  vin: string;
  model: string;
  variant: string;
  deliveredAt: string | null;
  warrantyMonths: number | null;
  warrantyExpiry: string | null;
  active: boolean;
}
export interface CustomerRelated {
  bookings: { id: string; code: string; status: string; createdAt: string }[];
  payments: { id: string; amount: string; mode: string; context: string; paidAt: string }[];
  deliveries: { id: string; saleId: string; deliveredAt: string; vin: string }[];
  service: { id: string; code: string; status: string; type: string; priority: string; total: string; technician: string | null; complaint: string; createdAt: string }[];
  warranty: WarrantyDto[];
}
export interface FollowUpReminders {
  overdue: (CustomerFollowUpDto & { customer: { id: string; name: string; phone: string } })[];
  today: (CustomerFollowUpDto & { customer: { id: string; name: string; phone: string } })[];
  upcoming: (CustomerFollowUpDto & { customer: { id: string; name: string; phone: string } })[];
}
export interface CustomerStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
}
