/**
 * Domain enums shared between API (Prisma) and Web.
 * Keep in exact sync with prisma/schema.prisma enums.
 */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  SALES_EXECUTIVE: 'SALES_EXECUTIVE',
  TECHNICIAN: 'TECHNICIAN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  INTERESTED: 'INTERESTED',
  TEST_RIDE: 'TEST_RIDE',
  NEGOTIATION: 'NEGOTIATION',
  BOOKED: 'BOOKED',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];
export const LEAD_STATUSES = Object.values(LeadStatus);

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];
export const GENDERS = Object.values(Gender);

/** Every kind of entry that can appear on the immutable customer timeline. */
export const CustomerEventType = {
  LEAD_CREATED: 'LEAD_CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  PHONE_CALL: 'PHONE_CALL',
  WALK_IN: 'WALK_IN',
  TEST_RIDE: 'TEST_RIDE',
  QUOTATION: 'QUOTATION',
  BOOKING: 'BOOKING',
  ADVANCE_PAYMENT: 'ADVANCE_PAYMENT',
  FINANCE_APPROVED: 'FINANCE_APPROVED',
  INSURANCE_ADDED: 'INSURANCE_ADDED',
  VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  DELIVERY: 'DELIVERY',
  FIRST_SERVICE: 'FIRST_SERVICE',
  WARRANTY: 'WARRANTY',
  FEEDBACK: 'FEEDBACK',
  REFERRAL: 'REFERRAL',
  NOTE_ADDED: 'NOTE_ADDED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  FOLLOW_UP_SCHEDULED: 'FOLLOW_UP_SCHEDULED',
  FOLLOW_UP_COMPLETED: 'FOLLOW_UP_COMPLETED',
} as const;
export type CustomerEventType = (typeof CustomerEventType)[keyof typeof CustomerEventType];
export const CUSTOMER_EVENT_TYPES = Object.values(CustomerEventType);

/** Timeline events a Sales Executive can log by hand (each creates an immutable entry). */
export const MANUAL_CUSTOMER_EVENTS = [
  CustomerEventType.PHONE_CALL,
  CustomerEventType.WALK_IN,
  CustomerEventType.TEST_RIDE,
  CustomerEventType.FEEDBACK,
  CustomerEventType.REFERRAL,
] as const;

export const FollowUpPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type FollowUpPriority = (typeof FollowUpPriority)[keyof typeof FollowUpPriority];
export const FOLLOW_UP_PRIORITIES = Object.values(FollowUpPriority);

export const FollowUpStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type FollowUpStatus = (typeof FollowUpStatus)[keyof typeof FollowUpStatus];
export const FOLLOW_UP_STATUSES = Object.values(FollowUpStatus);

export const DocumentType = {
  AADHAAR: 'AADHAAR',
  DRIVING_LICENSE: 'DRIVING_LICENSE',
  PAN: 'PAN',
  FINANCE: 'FINANCE',
  INSURANCE: 'INSURANCE',
  INVOICE: 'INVOICE',
  WARRANTY: 'WARRANTY',
  DELIVERY_PHOTO: 'DELIVERY_PHOTO',
  SIGNATURE: 'SIGNATURE',
  GOOGLE_REVIEW: 'GOOGLE_REVIEW',
  PHOTO: 'PHOTO',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];
export const DOCUMENT_TYPES = Object.values(DocumentType);

export const UnitStatus = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  BOOKED: 'BOOKED',
  DELIVERED: 'DELIVERED',
  IN_SERVICE: 'IN_SERVICE',
  RETURNED: 'RETURNED',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];
export const UNIT_STATUSES = Object.values(UnitStatus);

/**
 * Allowed status transitions (enforced server-side). Creation seeds AVAILABLE
 * with a "Purchased" history event. Every transition is recorded immutably.
 */
export const UNIT_STATUS_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  AVAILABLE: ['RESERVED', 'BOOKED', 'IN_SERVICE'],
  RESERVED: ['AVAILABLE', 'BOOKED'],
  BOOKED: ['AVAILABLE', 'DELIVERED'],
  DELIVERED: ['IN_SERVICE', 'RETURNED'],
  IN_SERVICE: ['AVAILABLE', 'DELIVERED', 'RETURNED'],
  RETURNED: ['AVAILABLE', 'IN_SERVICE'],
};

export function canTransitionUnit(from: UnitStatus, to: UnitStatus): boolean {
  return UNIT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TestRideStatus = {
  SCHEDULED: 'SCHEDULED',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type TestRideStatus = (typeof TestRideStatus)[keyof typeof TestRideStatus];
export const TEST_RIDE_STATUSES = Object.values(TestRideStatus);

export const BookingStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  CONVERTED: 'CONVERTED',
  CANCELLED: 'CANCELLED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];
export const BOOKING_STATUSES = Object.values(BookingStatus);

export const QuotationStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type QuotationStatus = (typeof QuotationStatus)[keyof typeof QuotationStatus];
export const QUOTATION_STATUSES = Object.values(QuotationStatus);

export const FinanceStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type FinanceStatus = (typeof FinanceStatus)[keyof typeof FinanceStatus];
export const FINANCE_STATUSES = Object.values(FinanceStatus);

export const InsuranceStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type InsuranceStatus = (typeof InsuranceStatus)[keyof typeof InsuranceStatus];
export const INSURANCE_STATUSES = Object.values(InsuranceStatus);

/** Aggregate payment state of a deal (computed from payments vs total). */
export const PaymentStatus = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const SaleStatus = {
  DRAFT: 'DRAFT',
  INVOICED: 'INVOICED',
  PAID: 'PAID',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];
export const SALE_STATUSES = Object.values(SaleStatus);

export const PaymentMode = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  BANK_TRANSFER: 'BANK_TRANSFER',
  FINANCE: 'FINANCE',
  EXCHANGE: 'EXCHANGE',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];
export const PAYMENT_MODES = Object.values(PaymentMode);

export const PaymentContext = {
  BOOKING_ADVANCE: 'BOOKING_ADVANCE',
  SALE: 'SALE',
  SERVICE: 'SERVICE',
} as const;
export type PaymentContext = (typeof PaymentContext)[keyof typeof PaymentContext];
export const PAYMENT_CONTEXTS = Object.values(PaymentContext);

export const ServiceJobType = {
  FREE: 'FREE',
  PAID: 'PAID',
  WARRANTY: 'WARRANTY',
} as const;
export type ServiceJobType = (typeof ServiceJobType)[keyof typeof ServiceJobType];
export const SERVICE_JOB_TYPES = Object.values(ServiceJobType);

export const ServiceStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  READY: 'READY',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
export const SERVICE_STATUSES = Object.values(ServiceStatus);

export const ExpenseCategory = {
  RENT: 'RENT',
  ELECTRICITY: 'ELECTRICITY',
  SALARY: 'SALARY',
  MARKETING: 'MARKETING',
  TEA: 'TEA',
  FUEL: 'FUEL',
  CLEANING: 'CLEANING',
  OFFICE: 'OFFICE',
  MISC: 'MISC',
} as const;
export type ExpenseCategory = (typeof ExpenseCategory)[keyof typeof ExpenseCategory];
export const EXPENSE_CATEGORIES = Object.values(ExpenseCategory);

export const NotificationType = {
  DELIVERY_UPCOMING: 'DELIVERY_UPCOMING',
  PAYMENT_DUE: 'PAYMENT_DUE',
  SERVICE_DUE: 'SERVICE_DUE',
  LOW_INVENTORY: 'LOW_INVENTORY',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPES = Object.values(NotificationType);

export const ActivityAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  LOGIN: 'LOGIN',
  PAYMENT: 'PAYMENT',
  EXPORT: 'EXPORT',
} as const;
export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];
export const ACTIVITY_ACTIONS = Object.values(ActivityAction);
