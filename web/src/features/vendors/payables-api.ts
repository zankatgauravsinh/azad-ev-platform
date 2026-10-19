import type {
  ApplyVendorPaymentInput,
  CancelVendorPaymentInput,
  CreateVendorPaymentInput,
  ListVendorBillsQuery,
  ListVendorPaymentsQuery,
  Paginated,
  VendorBillDto,
  VendorOverviewDto,
  VendorPaymentDto,
  VendorStatementDto,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const clean = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'ALL').map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]));

type PaymentListParams = Partial<Omit<ListVendorPaymentsQuery, 'withAdvance'>> & { withAdvance?: boolean };

/** What the showroom owes its vendors (bills, overview, statement) and pays them (vendor payments). */
export const vendorPayablesApi = {
  overview: async (vendorId: string): Promise<VendorOverviewDto> => (await apiClient.get(`/vendors/${vendorId}/overview`)).data,
  bills: async (vendorId: string, q: Partial<ListVendorBillsQuery> = {}): Promise<VendorBillDto[]> => (await apiClient.get(`/vendors/${vendorId}/bills`, { params: clean(q) })).data,
  statement: async (vendorId: string, r: { from?: string; to?: string }): Promise<VendorStatementDto> => (await apiClient.get(`/vendors/${vendorId}/statement`, { params: clean(r) })).data,
  statementPdf: async (vendorId: string, r: { from?: string; to?: string }): Promise<Blob> => (await apiClient.get(`/vendors/${vendorId}/statement.pdf`, { params: clean(r), responseType: 'blob' })).data,

  payments: async (q: PaymentListParams): Promise<Paginated<VendorPaymentDto>> => (await apiClient.get('/vendor-payments', { params: clean(q) })).data,
  payment: async (id: string): Promise<VendorPaymentDto> => (await apiClient.get(`/vendor-payments/${id}`)).data,
  pay: async (body: CreateVendorPaymentInput): Promise<VendorPaymentDto> => (await apiClient.post('/vendor-payments', body)).data,
  apply: async (id: string, body: ApplyVendorPaymentInput): Promise<VendorPaymentDto> => (await apiClient.post(`/vendor-payments/${id}/apply`, body)).data,
  cancel: async (id: string, body: CancelVendorPaymentInput): Promise<VendorPaymentDto> => (await apiClient.post(`/vendor-payments/${id}/cancel`, body)).data,
  voucher: async (id: string): Promise<Blob> => (await apiClient.get(`/vendor-payments/${id}/voucher.pdf`, { responseType: 'blob' })).data,
};
export type { PaymentListParams };
