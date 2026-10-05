import type {
  AddPaymentInput,
  BookingStatus,
  CreateBookingInput,
  CreateQuotationInput,
  ConvertQuotationInput,
  FinanceDto,
  InsuranceDto,
  ListBookingsQuery,
  ListQuotationsQuery,
  MarkDeliveredInput,
  Paginated,
  PaymentDto,
  PaymentStatus,
  QuotationStatus,
  ScheduleDeliveryInput,
  UnitStatus,
  UpdateBookingInput,
  UpdateQuotationInput,
  UpsertFinanceInput,
  UpsertInsuranceInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface AccessoryRef {
  id: string;
  name: string;
  /** GST classification assigned to the accessory (null / absent = not classified). */
  taxClassificationId?: string | null;
  sellPrice: string;
  avgCost: string;
  isPart: boolean;
}
export interface CustomerRef {
  id: string;
  name: string;
  phone: string;
  address?: string | null;
  city?: string | null;
}
export interface VariantRef {
  id: string;
  name: string;
  colour: string;
  model: { id: string; name: string; brand: string };
}

/**
 * Full vehicle (InventoryUnit → variant → model) as already returned by the bookings read `include`.
 * These fields are present on the wire today; typing them lets the Vehicle Details modal render them
 * without any duplication into Booking. Dealer-margin fields (purchaseCost, supplier) are intentionally
 * omitted — they are not surfaced to the booking UI.
 */
export interface VehicleVariantDetail {
  id: string;
  name: string;
  colour: string;
  hexColour: string | null;
  batteryType: string | null;
  batteryCapacity: string | null;
  rangeKm: number | null;
  topSpeedKmph: number | null;
  chargingTimeHrs: string | null;
  motorPowerW: number | null;
  warrantyMonths: number | null;
  model: { id: string; name: string; brand: string; description: string | null };
}
export interface VehicleUnitDetail {
  id: string;
  vin: string;
  motorNumber: string;
  batteryNumber: string;
  status: UnitStatus;
  purchaseDate: string | null;
  sellingPrice: string;
  location: string | null;
  notes: string | null;
  variant: VehicleVariantDetail;
}
export interface QuotationDto {
  id: string;
  code: string;
  status: QuotationStatus;
  customer: CustomerRef;
  variant: VariantRef;
  exShowroom: string;
  discount: string;
  exchangeValue: string;
  accessoriesTotal: string;
  rto: string;
  insurance: string;
  registration: string;
  extendedWarranty: string;
  total: string;
  financeDownPayment: string;
  financeLoanAmount: string;
  financeTenureMonths: number;
  financeEmi: string;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  accessories: { id: string; accessoryId: string; qty: number; unitPrice: string; accessory: { name: string } }[];
  booking: { id: string; code: string } | null;
}
export interface BookingDto {
  id: string;
  code: string;
  status: BookingStatus;
  customer: CustomerRef;
  unit: VehicleUnitDetail;
  salesExecutive: { id: string; name: string } | null;
  deliveryExecutive: { id: string; name: string } | null;
  exShowroom: string;
  discount: string;
  exchangeValue: string;
  accessoriesTotal: string;
  rto: string;
  insuranceCharge: string;
  registration: string;
  extendedWarranty: string;
  total: string;
  advanceAmount: string;
  financeRequired: boolean;
  insuranceRequired: boolean;
  expectedDelivery: string | null;
  actualDelivery: string | null;
  pendingDocuments: string | null;
  notes: string | null;
  accessories: { id: string; accessoryId: string; qty: number; unitPrice: string; accessory: { name: string } }[];
  finance: FinanceDto | null;
  insurance: InsuranceDto | null;
  payments: PaymentDto[];
  sale: { id: string; invoiceNumber: string | null; status: string; invoicedAt: string | null } | null;
  quotation: { id: string; code: string } | null;
  paymentSummary: { total: string; paid: string; balance: string; status: PaymentStatus };
}

const params = (q: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) out[k] = String(v);
  return out;
};

export const salesApi = {
  accessories: async (): Promise<AccessoryRef[]> => (await apiClient.get('/accessories')).data,

  // Quotations
  listQuotations: async (q: Partial<ListQuotationsQuery>): Promise<Paginated<QuotationDto>> => (await apiClient.get('/quotations', { params: params(q) })).data,
  getQuotation: async (id: string): Promise<QuotationDto> => (await apiClient.get(`/quotations/${id}`)).data,
  createQuotation: async (input: CreateQuotationInput): Promise<QuotationDto> => (await apiClient.post('/quotations', input)).data,
  updateQuotation: async (id: string, input: UpdateQuotationInput): Promise<QuotationDto> => (await apiClient.patch(`/quotations/${id}`, input)).data,
  changeQuotationStatus: async (id: string, status: QuotationStatus): Promise<QuotationDto> => (await apiClient.patch(`/quotations/${id}/status`, { status })).data,
  duplicateQuotation: async (id: string): Promise<QuotationDto> => (await apiClient.post(`/quotations/${id}/duplicate`)).data,
  convertQuotation: async (id: string, input: ConvertQuotationInput): Promise<BookingDto> => (await apiClient.post(`/quotations/${id}/convert`, input)).data,
  removeQuotation: async (id: string): Promise<void> => { await apiClient.delete(`/quotations/${id}`); },
  quotationPdf: async (id: string): Promise<Blob> => (await apiClient.get(`/quotations/${id}/pdf`, { responseType: 'blob' })).data,

  // Bookings
  listBookings: async (q: Partial<ListBookingsQuery>): Promise<Paginated<BookingDto>> => (await apiClient.get('/bookings', { params: params(q) })).data,
  getBooking: async (id: string): Promise<BookingDto> => (await apiClient.get(`/bookings/${id}`)).data,
  createBooking: async (input: CreateBookingInput): Promise<BookingDto> => (await apiClient.post('/bookings', input)).data,
  updateBooking: async (id: string, input: UpdateBookingInput): Promise<BookingDto> => (await apiClient.patch(`/bookings/${id}`, input)).data,
  cancelBooking: async (id: string, reason?: string): Promise<BookingDto> => (await apiClient.post(`/bookings/${id}/cancel`, { reason })).data,
  addPayment: async (id: string, input: AddPaymentInput): Promise<PaymentDto> => (await apiClient.post(`/bookings/${id}/payments`, input)).data,
  upsertFinance: async (id: string, input: UpsertFinanceInput): Promise<FinanceDto> => (await apiClient.post(`/bookings/${id}/finance`, input)).data,
  upsertInsurance: async (id: string, input: UpsertInsuranceInput): Promise<InsuranceDto> => (await apiClient.post(`/bookings/${id}/insurance`, input)).data,
  scheduleDelivery: async (id: string, input: ScheduleDeliveryInput): Promise<BookingDto> => (await apiClient.post(`/bookings/${id}/schedule-delivery`, input)).data,
  deliver: async (id: string, input: MarkDeliveredInput = {}): Promise<BookingDto> => (await apiClient.post(`/bookings/${id}/deliver`, input)).data,
  generateInvoice: async (id: string): Promise<BookingDto> => (await apiClient.post(`/bookings/${id}/invoice`, {})).data,
  invoicePdf: async (id: string): Promise<Blob> => (await apiClient.get(`/bookings/${id}/invoice/pdf`, { responseType: 'blob' })).data,
};
