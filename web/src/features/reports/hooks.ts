import { useQuery } from '@tanstack/react-query';
import { reportsApi, type Range } from './api';

export const useOverviewReport = (r: Range) => useQuery({ queryKey: ['reports', 'overview', r], queryFn: () => reportsApi.overview(r) });
export const useSalesReport = (r: Range) => useQuery({ queryKey: ['reports', 'sales', r], queryFn: () => reportsApi.sales(r) });
export const useCustomersReport = (r: Range) => useQuery({ queryKey: ['reports', 'customers', r], queryFn: () => reportsApi.customers(r) });
export const useInventoryReport = () => useQuery({ queryKey: ['reports', 'inventory'], queryFn: () => reportsApi.inventory() });
export const usePaymentsReport = (r: Range) => useQuery({ queryKey: ['reports', 'payments', r], queryFn: () => reportsApi.payments(r) });
