/**
 * Domain enums shared between API (Prisma) and Web.
 * Keep in exact sync with prisma/schema.prisma enums.
 */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  SALES_EXECUTIVE: 'SALES_EXECUTIVE',
  TECHNICIAN: 'TECHNICIAN',
  ACCOUNTANT: 'ACCOUNTANT',
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
  JOB_CARD_CREATED: 'JOB_CARD_CREATED',
  VEHICLE_CHECKED_IN: 'VEHICLE_CHECKED_IN',
  DIAGNOSIS_COMPLETE: 'DIAGNOSIS_COMPLETE',
  REPAIR_STARTED: 'REPAIR_STARTED',
  PARTS_ADDED: 'PARTS_ADDED',
  QUALITY_CHECK: 'QUALITY_CHECK',
  SERVICE_DELIVERED: 'SERVICE_DELIVERED',
  FEEDBACK_RECEIVED: 'FEEDBACK_RECEIVED',
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
  FREE_1: 'FREE_1',
  FREE_2: 'FREE_2',
  FREE_3: 'FREE_3',
  PAID: 'PAID',
  WARRANTY: 'WARRANTY',
  REPAIR: 'REPAIR',
  INSPECTION: 'INSPECTION',
} as const;
export type ServiceJobType = (typeof ServiceJobType)[keyof typeof ServiceJobType];
export const SERVICE_JOB_TYPES = Object.values(ServiceJobType);
export const FREE_SERVICE_TYPES = [ServiceJobType.FREE_1, ServiceJobType.FREE_2, ServiceJobType.FREE_3] as const;

export const ServiceStatus = {
  BOOKED: 'BOOKED',
  CHECKED_IN: 'CHECKED_IN',
  DIAGNOSIS: 'DIAGNOSIS',
  WAITING_FOR_PARTS: 'WAITING_FOR_PARTS',
  REPAIRING: 'REPAIRING',
  QUALITY_CHECK: 'QUALITY_CHECK',
  READY: 'READY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
export const SERVICE_STATUSES = Object.values(ServiceStatus);

/** Allowed status transitions for a service job (mirrors the workshop flow). */
export const SERVICE_STATUS_TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  BOOKED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['DIAGNOSIS', 'CANCELLED'],
  DIAGNOSIS: ['WAITING_FOR_PARTS', 'REPAIRING', 'CANCELLED'],
  WAITING_FOR_PARTS: ['REPAIRING', 'CANCELLED'],
  REPAIRING: ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK: ['READY', 'REPAIRING', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
export function canTransitionService(from: ServiceStatus, to: ServiceStatus): boolean {
  return SERVICE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ServicePriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  EMERGENCY: 'EMERGENCY',
} as const;
export type ServicePriority = (typeof ServicePriority)[keyof typeof ServicePriority];
export const SERVICE_PRIORITIES = Object.values(ServicePriority);

export const InspectionResult = {
  GOOD: 'GOOD',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  REPLACED: 'REPLACED',
} as const;
export type InspectionResult = (typeof InspectionResult)[keyof typeof InspectionResult];
export const INSPECTION_RESULTS = Object.values(InspectionResult);

/** Fixed inspection checklist (spec order). */
export const INSPECTION_ITEMS = [
  'Brakes', 'Lights', 'Horn', 'Tyres', 'Suspension', 'Battery',
  'Motor', 'Controller', 'Display', 'Charging Port', 'Fasteners', 'Test Ride',
] as const;
export type InspectionItem = (typeof INSPECTION_ITEMS)[number];

/** Notification category (the `type` column). */
export const NotificationType = {
  DELIVERY: 'DELIVERY',
  PAYMENT: 'PAYMENT',
  SERVICE: 'SERVICE',
  INVENTORY: 'INVENTORY',
  CUSTOMER: 'CUSTOMER',
  WARRANTY: 'WARRANTY',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPES = Object.values(NotificationType);

export const NotificationPriority = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];
export const NOTIFICATION_PRIORITIES = Object.values(NotificationPriority);

export const BackupFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type BackupFrequency = (typeof BackupFrequency)[keyof typeof BackupFrequency];
export const BACKUP_FREQUENCIES = Object.values(BackupFrequency);

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

/* ------------------------------------------------------------------ *
 * Module 8 — Warranty & AMC
 * ------------------------------------------------------------------ */

export const WarrantyStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  CLAIMED: 'CLAIMED',
} as const;
export type WarrantyStatus = (typeof WarrantyStatus)[keyof typeof WarrantyStatus];
export const WARRANTY_STATUSES = Object.values(WarrantyStatus);

export const WarrantyClaimStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
} as const;
export type WarrantyClaimStatus = (typeof WarrantyClaimStatus)[keyof typeof WarrantyClaimStatus];
export const WARRANTY_CLAIM_STATUSES = Object.values(WarrantyClaimStatus);

export const FreeServiceStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  MISSED: 'MISSED',
} as const;
export type FreeServiceStatus = (typeof FreeServiceStatus)[keyof typeof FreeServiceStatus];
export const FREE_SERVICE_STATUSES = Object.values(FreeServiceStatus);

export const AmcPlanType = {
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
  CUSTOM: 'CUSTOM',
} as const;
export type AmcPlanType = (typeof AmcPlanType)[keyof typeof AmcPlanType];
export const AMC_PLAN_TYPES = Object.values(AmcPlanType);

export const AmcStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type AmcStatus = (typeof AmcStatus)[keyof typeof AmcStatus];
export const AMC_STATUSES = Object.values(AmcStatus);

/** Standard warranty coverage line items for an EV scooter. */
export const WarrantyCoverageItem = {
  MOTOR: 'MOTOR',
  BATTERY: 'BATTERY',
  CONTROLLER: 'CONTROLLER',
  CHARGER: 'CHARGER',
  DISPLAY: 'DISPLAY',
  FRAME: 'FRAME',
  SUSPENSION: 'SUSPENSION',
  BRAKE_COMPONENTS: 'BRAKE_COMPONENTS',
  ELECTRICAL_COMPONENTS: 'ELECTRICAL_COMPONENTS',
  ACCESSORIES: 'ACCESSORIES',
  CUSTOM: 'CUSTOM',
} as const;
export type WarrantyCoverageItem = (typeof WarrantyCoverageItem)[keyof typeof WarrantyCoverageItem];
export const WARRANTY_COVERAGE_ITEMS = Object.values(WarrantyCoverageItem);

/** Items excluded from cover by default (wear-and-tear); everything else is covered. */
export const DEFAULT_EXCLUDED_COVERAGE_ITEMS: WarrantyCoverageItem[] = [
  WarrantyCoverageItem.BRAKE_COMPONENTS,
  WarrantyCoverageItem.ACCESSORIES,
];

/* ------------------------------------------------------------------ *
 * Module 9 — Finance & Expense Management
 * ------------------------------------------------------------------ */

export const ExpenseStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];
export const EXPENSE_STATUSES = Object.values(ExpenseStatus);

export const ExpenseAttachmentType = {
  INVOICE: 'INVOICE',
  GST_BILL: 'GST_BILL',
  PHOTO: 'PHOTO',
  PDF: 'PDF',
  OTHER: 'OTHER',
} as const;
export type ExpenseAttachmentType = (typeof ExpenseAttachmentType)[keyof typeof ExpenseAttachmentType];
export const EXPENSE_ATTACHMENT_TYPES = Object.values(ExpenseAttachmentType);

export const BankReconStatus = {
  PENDING: 'PENDING',
  CLEARED: 'CLEARED',
  RECONCILED: 'RECONCILED',
} as const;
export type BankReconStatus = (typeof BankReconStatus)[keyof typeof BankReconStatus];
export const BANK_RECON_STATUSES = Object.values(BankReconStatus);

export const VendorStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];
export const VENDOR_STATUSES = Object.values(VendorStatus);

/** How a finance transaction was settled. */
export const FinancePayMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
} as const;
export type FinancePayMethod = (typeof FinancePayMethod)[keyof typeof FinancePayMethod];
export const FINANCE_PAY_METHODS = Object.values(FinancePayMethod);

/** Kinds of accessory stock movement in the audit ledger. */
export const AccessoryMovementType = {
  OPENING: 'OPENING',
  PURCHASE_IN: 'PURCHASE_IN',
  SALE_OUT: 'SALE_OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
} as const;
export type AccessoryMovementType = (typeof AccessoryMovementType)[keyof typeof AccessoryMovementType];
export const ACCESSORY_MOVEMENT_TYPES = Object.values(AccessoryMovementType);

export const IncomeSource = {
  ACCESSORIES: 'ACCESSORIES',
  INSURANCE_COMMISSION: 'INSURANCE_COMMISSION',
  FINANCE_COMMISSION: 'FINANCE_COMMISSION',
  REGISTRATION: 'REGISTRATION',
  SERVICE: 'SERVICE',
  AMC: 'AMC',
  WARRANTY_RECOVERY: 'WARRANTY_RECOVERY',
  OTHER: 'OTHER',
} as const;
export type IncomeSource = (typeof IncomeSource)[keyof typeof IncomeSource];
export const INCOME_SOURCES = Object.values(IncomeSource);

export const BankTxnType = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  IMPS: 'IMPS',
  CHEQUE: 'CHEQUE',
  UPI: 'UPI',
} as const;
export type BankTxnType = (typeof BankTxnType)[keyof typeof BankTxnType];
export const BANK_TXN_TYPES = Object.values(BankTxnType);

/** Whether a bank transaction increases (CREDIT) or decreases (DEBIT) the bank balance. */
export const BankDirection = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;
export type BankDirection = (typeof BankDirection)[keyof typeof BankDirection];
export const BANK_DIRECTIONS = Object.values(BankDirection);

/** The 15 seeded expense categories (custom ones can be added). */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Internet',
  'Salary',
  'Fuel',
  'Office',
  'Marketing',
  'Repairs',
  'Maintenance',
  'Tea & Snacks',
  'Transportation',
  'Stationery',
  'Insurance',
  'Vehicle Purchase',
  'Accessories',
] as const;
