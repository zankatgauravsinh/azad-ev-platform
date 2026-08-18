import type { CustomerEventType, LeadStatus } from './enums';

export interface CountAmount {
  count: number;
  amount: string;
}

export interface TodaysWork {
  deliveries: number;
  followUps: number;
  pendingPayments: CountAmount;
  pendingFinanceApprovals: number;
  pendingInsurance: number;
  serviceDueToday: number;
  lowInventory: number;
  overdueBookings: number;
}

export interface BusinessOverview {
  todaySales: CountAmount;
  todayCollections: string;
  monthlySales: CountAmount;
  monthlyCollections: string;
  availableInventory: number;
  bookedInventory: number;
  deliveredVehicles: number;
  activeCustomers: number;
}

export interface RecentActivityItem {
  id: string;
  type: CustomerEventType;
  title: string;
  customer: { id: string; name: string } | null;
  occurredAt: string;
}

export interface ReminderItem {
  id: string;
  label: string;
  sub: string;
  date: string | null;
  href: string;
}

export interface DashboardReminders {
  upcomingDeliveries: ReminderItem[];
  followUps: ReminderItem[];
  pendingDocuments: ReminderItem[];
  pendingBalance: ReminderItem[];
  serviceDue: ReminderItem[];
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  label: string; // e.g. "Jul"
  amount: string;
  count: number;
}

export interface DashboardCharts {
  monthlySales: MonthlyPoint[];
  monthlyCollections: MonthlyPoint[];
  leadConversion: { status: LeadStatus; count: number }[];
}

export interface TechnicianWorkloadRow {
  technicianId: string;
  name: string;
  openJobs: number;
}

export interface UpcomingFreeService {
  customerId: string;
  customer: string;
  vin: string;
  service: string; // e.g. "1st Free Service"
  dueDate: string;
}

export interface ServiceDashboard {
  todaysServices: number;
  overdueServices: number;
  readyForDelivery: number;
  pendingQualityCheck: number;
  lowPartsStock: number;
  technicianWorkload: TechnicianWorkloadRow[];
  upcomingFreeServices: UpcomingFreeService[];
}

export interface DashboardSummary {
  todaysWork: TodaysWork;
  businessOverview: BusinessOverview;
  service: ServiceDashboard;
  recentActivity: RecentActivityItem[];
  reminders: DashboardReminders;
  charts: DashboardCharts;
  generatedAt: string;
}

// ── Global search ─────────────────────────────────────────
export interface SearchResults {
  customers: { id: string; name: string; phone: string }[];
  units: { id: string; vin: string; status: string; model: string }[];
  bookings: { id: string; code: string; customer: string; status: string }[];
  invoices: { id: string; invoiceNumber: string; customer: string }[];
  serviceJobs: { id: string; code: string; customer: string; status: string; technician: string | null }[];
  warranties: { id: string; warrantyNumber: string; customer: string; status: string }[];
  amc: { id: string; amcNumber: string; customer: string; status: string }[];
  expenses: { id: string; expenseNumber: string; category: string; amount: string }[];
  vendors: { id: string; vendorNumber: string; name: string }[];
  income: { id: string; incomeNumber: string; source: string }[];
}
