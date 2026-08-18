import type {
  CustomersReport,
  ExportFormat,
  InventoryReport,
  OverviewReport,
  PaymentsReport,
  ReportType,
  SalesReport,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface Range {
  from?: string;
  to?: string;
}

const params = (r?: Range): Record<string, string> => (r?.from && r?.to ? { from: r.from, to: r.to } : {});

export const reportsApi = {
  overview: async (r?: Range): Promise<OverviewReport> => (await apiClient.get('/reports/overview', { params: params(r) })).data,
  sales: async (r?: Range): Promise<SalesReport> => (await apiClient.get('/reports/sales', { params: params(r) })).data,
  customers: async (r?: Range): Promise<CustomersReport> => (await apiClient.get('/reports/customers', { params: params(r) })).data,
  inventory: async (): Promise<InventoryReport> => (await apiClient.get('/reports/inventory')).data,
  payments: async (r?: Range): Promise<PaymentsReport> => (await apiClient.get('/reports/payments', { params: params(r) })).data,
  exportReport: async (type: ReportType, format: ExportFormat, r?: Range): Promise<Blob> =>
    (await apiClient.get(`/reports/${type}/export`, { params: { format, ...params(r) }, responseType: 'blob' })).data,
};
