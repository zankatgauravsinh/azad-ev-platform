import {
  BookingStatus,
  CustomerEventType,
  FinanceStatus,
  FollowUpPriority,
  InsuranceStatus,
  LeadStatus,
  PaymentStatus,
  QuotationStatus,
  Role,
  ServicePriority,
  ServiceStatus,
  UnitStatus,
} from '@azad/shared';

const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: 'Owner',
  [Role.MANAGER]: 'Manager',
  [Role.SALES_EXECUTIVE]: 'Sales Executive',
  [Role.TECHNICIAN]: 'Technician',
  [Role.ACCOUNTANT]: 'Accountant',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

const UNIT_STATUS_META: Record<UnitStatus, { label: string; tone: BadgeTone }> = {
  [UnitStatus.AVAILABLE]: { label: 'Available', tone: 'success' },
  [UnitStatus.RESERVED]: { label: 'Reserved', tone: 'warning' },
  [UnitStatus.BOOKED]: { label: 'Booked', tone: 'accent' },
  [UnitStatus.DELIVERED]: { label: 'Delivered', tone: 'muted' },
  [UnitStatus.IN_SERVICE]: { label: 'In Service', tone: 'info' },
  [UnitStatus.RETURNED]: { label: 'Returned', tone: 'destructive' },
};

export function unitStatusLabel(status: UnitStatus): string {
  return UNIT_STATUS_META[status]?.label ?? status;
}

export function unitStatusTone(status: UnitStatus): BadgeTone {
  return UNIT_STATUS_META[status]?.tone ?? 'muted';
}

const LEAD_STATUS_META: Record<LeadStatus, { label: string; tone: BadgeTone }> = {
  [LeadStatus.NEW]: { label: 'New', tone: 'info' },
  [LeadStatus.CONTACTED]: { label: 'Contacted', tone: 'muted' },
  [LeadStatus.INTERESTED]: { label: 'Interested', tone: 'accent' },
  [LeadStatus.TEST_RIDE]: { label: 'Test Ride', tone: 'warning' },
  [LeadStatus.NEGOTIATION]: { label: 'Negotiation', tone: 'warning' },
  [LeadStatus.BOOKED]: { label: 'Booked', tone: 'accent' },
  [LeadStatus.WON]: { label: 'Won', tone: 'success' },
  [LeadStatus.LOST]: { label: 'Lost', tone: 'destructive' },
};

export function leadStatusLabel(status: LeadStatus): string {
  return LEAD_STATUS_META[status]?.label ?? status;
}
export function leadStatusTone(status: LeadStatus): BadgeTone {
  return LEAD_STATUS_META[status]?.tone ?? 'muted';
}

export function eventTypeLabel(type: CustomerEventType): string {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

const PRIORITY_META: Record<FollowUpPriority, BadgeTone> = {
  [FollowUpPriority.LOW]: 'muted',
  [FollowUpPriority.MEDIUM]: 'info',
  [FollowUpPriority.HIGH]: 'destructive',
};
export function priorityTone(p: FollowUpPriority): BadgeTone {
  return PRIORITY_META[p] ?? 'muted';
}

const QUOTATION_TONE: Record<QuotationStatus, BadgeTone> = {
  [QuotationStatus.DRAFT]: 'muted',
  [QuotationStatus.SENT]: 'info',
  [QuotationStatus.ACCEPTED]: 'success',
  [QuotationStatus.EXPIRED]: 'warning',
  [QuotationStatus.CANCELLED]: 'destructive',
};
export const quotationTone = (s: QuotationStatus): BadgeTone => QUOTATION_TONE[s] ?? 'muted';

const BOOKING_TONE: Record<BookingStatus, BadgeTone> = {
  [BookingStatus.DRAFT]: 'muted',
  [BookingStatus.CONFIRMED]: 'accent',
  [BookingStatus.CONVERTED]: 'success',
  [BookingStatus.CANCELLED]: 'destructive',
};
export const bookingTone = (s: BookingStatus): BadgeTone => BOOKING_TONE[s] ?? 'muted';

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  [PaymentStatus.PENDING]: 'destructive',
  [PaymentStatus.PARTIAL]: 'warning',
  [PaymentStatus.PAID]: 'success',
};
export const paymentTone = (s: PaymentStatus): BadgeTone => PAYMENT_TONE[s] ?? 'muted';

const FINANCE_TONE: Record<FinanceStatus, BadgeTone> = {
  [FinanceStatus.PENDING]: 'warning',
  [FinanceStatus.APPROVED]: 'success',
  [FinanceStatus.REJECTED]: 'destructive',
  [FinanceStatus.CANCELLED]: 'muted',
};
export const financeTone = (s: FinanceStatus): BadgeTone => FINANCE_TONE[s] ?? 'muted';

const INSURANCE_TONE: Record<InsuranceStatus, BadgeTone> = {
  [InsuranceStatus.PENDING]: 'warning',
  [InsuranceStatus.ACTIVE]: 'success',
  [InsuranceStatus.EXPIRED]: 'muted',
  [InsuranceStatus.CANCELLED]: 'destructive',
};
export const insuranceTone = (s: InsuranceStatus): BadgeTone => INSURANCE_TONE[s] ?? 'muted';

const SERVICE_TONE: Record<ServiceStatus, BadgeTone> = {
  [ServiceStatus.BOOKED]: 'muted',
  [ServiceStatus.CHECKED_IN]: 'info',
  [ServiceStatus.DIAGNOSIS]: 'info',
  [ServiceStatus.WAITING_FOR_PARTS]: 'warning',
  [ServiceStatus.REPAIRING]: 'accent',
  [ServiceStatus.QUALITY_CHECK]: 'warning',
  [ServiceStatus.READY]: 'success',
  [ServiceStatus.DELIVERED]: 'success',
  [ServiceStatus.CANCELLED]: 'destructive',
};
export const serviceTone = (s: ServiceStatus): BadgeTone => SERVICE_TONE[s] ?? 'muted';

const SERVICE_PRIORITY_TONE: Record<ServicePriority, BadgeTone> = {
  [ServicePriority.LOW]: 'muted',
  [ServicePriority.MEDIUM]: 'info',
  [ServicePriority.HIGH]: 'warning',
  [ServicePriority.EMERGENCY]: 'destructive',
};
export const servicePriorityTone = (s: ServicePriority): BadgeTone => SERVICE_PRIORITY_TONE[s] ?? 'muted';

export const titleCase = (s: string): string =>
  s.toLowerCase().split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

/** Polished display names for permission-catalog module keys (Role editor grouping headers). */
const PERMISSION_MODULE_LABELS: Record<string, string> = {
  spareparts: 'Spare Parts',
  amc: 'AMC',
  gst: 'GST',
  pnl: 'P&L',
};
export function permissionModuleLabel(moduleKey: string): string {
  return PERMISSION_MODULE_LABELS[moduleKey] ?? titleCase(moduleKey);
}
