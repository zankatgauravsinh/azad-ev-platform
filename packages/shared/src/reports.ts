import { z } from 'zod';
import type { MonthlyPoint } from './dashboard';

/** Report categories that support tabular export. */
export const REPORT_TYPES = ['sales', 'customers', 'inventory', 'payments', 'warranty', 'amc', 'expenses', 'income', 'vendors', 'bank', 'pnl', 'gst'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const EXPORT_FORMATS = ['pdf', 'excel', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Optional [from, to] date filter (ISO strings). Server defaults to a sensible window. */
export const reportRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;

export interface ReportRange {
  from: string;
  to: string;
}

export type KpiTone = 'default' | 'positive' | 'warning' | 'danger';
export interface ReportKpi {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
}

/** A labelled money+count pair — model sales, payment methods, etc. */
export interface NamedAmount {
  name: string;
  amount: string; // paise
  count: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  label: string; // e.g. "28 Jul"
  amount: string; // paise
  count: number;
}

export interface OverviewReport {
  range: ReportRange;
  kpis: ReportKpi[];
  monthlyRevenue: MonthlyPoint[];
  paymentMix: NamedAmount[];
}

export interface SalesReportRow {
  code: string;
  date: string;
  customer: string;
  vehicle: string;
  status: string;
  total: string;
}
export interface SalesReport {
  range: ReportRange;
  kpis: ReportKpi[];
  monthlySales: MonthlyPoint[];
  modelSales: NamedAmount[];
  rows: SalesReportRow[];
}

export interface TopCustomerRow {
  name: string;
  phone: string;
  orders: number;
  spent: string;
}
export interface CustomersReport {
  range: ReportRange;
  kpis: ReportKpi[];
  growth: MonthlyPoint[];
  topCustomers: TopCustomerRow[];
}

export interface InventoryModelRow {
  model: string;
  available: number;
  booked: number;
  delivered: number;
  total: number;
  value: string;
}
export interface LowStockRow {
  model: string;
  variant: string;
  colour: string;
  available: number;
}
export interface InventoryReport {
  kpis: ReportKpi[];
  byModel: InventoryModelRow[];
  lowStock: LowStockRow[];
  movement: MonthlyPoint[];
}

export interface PaymentReportRow {
  receipt: string;
  date: string;
  customer: string;
  mode: string;
  context: string;
  amount: string;
}
export interface PaymentsReport {
  range: ReportRange;
  kpis: ReportKpi[];
  byMode: NamedAmount[];
  daily: DailyPoint[];
  rows: PaymentReportRow[];
}
