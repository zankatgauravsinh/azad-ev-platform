import type {
  AddComplaintInput,
  AddServiceLabourInput,
  AddServicePartInput,
  AssignTechnicianInput,
  CreateLabourItemInput,
  CreateServiceJobInput,
  CreateSparePartInput,
  LabourItemDto,
  ListServiceJobsQuery,
  ListSparePartsQuery,
  Paginated,
  SaveInspectionInput,
  ServiceBillInput,
  ServiceFeedbackInput,
  ServiceJobDto,
  ServicePaymentInput,
  ServiceReports,
  SparePartDto,
  UpdateSparePartInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

const params = (q: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export type ServiceDoc = 'job-card' | 'estimate' | 'bill' | 'inspection';

export const serviceApi = {
  // Job cards
  list: async (q: Partial<ListServiceJobsQuery>): Promise<Paginated<ServiceJobDto>> => (await apiClient.get('/service/jobs', { params: params(q) })).data,
  technicians: async (): Promise<{ id: string; name: string }[]> => (await apiClient.get('/service/jobs/technicians')).data,
  get: async (id: string): Promise<ServiceJobDto> => (await apiClient.get(`/service/jobs/${id}`)).data,
  create: async (input: CreateServiceJobInput): Promise<ServiceJobDto> => (await apiClient.post('/service/jobs', input)).data,
  changeStatus: async (id: string, status: string): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/status`, { status })).data,
  assign: async (id: string, input: AssignTechnicianInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/technician`, input)).data,
  addComplaint: async (id: string, input: AddComplaintInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/complaints`, input)).data,
  resolveComplaint: async (id: string, complaintId: string): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/complaints/${complaintId}/resolve`, {})).data,
  saveInspection: async (id: string, input: SaveInspectionInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/inspection`, input)).data,
  addPart: async (id: string, input: AddServicePartInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/parts`, input)).data,
  removePart: async (id: string, partId: string): Promise<ServiceJobDto> => (await apiClient.delete(`/service/jobs/${id}/parts/${partId}`)).data,
  addLabour: async (id: string, input: AddServiceLabourInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/labour`, input)).data,
  removeLabour: async (id: string, labourId: string): Promise<ServiceJobDto> => (await apiClient.delete(`/service/jobs/${id}/labour/${labourId}`)).data,
  applyBill: async (id: string, input: ServiceBillInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/bill`, input)).data,
  addPayment: async (id: string, input: ServicePaymentInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/payments`, input)).data,
  feedback: async (id: string, input: ServiceFeedbackInput): Promise<ServiceJobDto> => (await apiClient.post(`/service/jobs/${id}/feedback`, input)).data,
  pdf: async (id: string, doc: ServiceDoc): Promise<Blob> => (await apiClient.get(`/service/jobs/${id}/pdf/${doc}`, { responseType: 'blob' })).data,

  // Catalogues
  spareParts: async (q: Partial<ListSparePartsQuery>): Promise<Paginated<SparePartDto>> => (await apiClient.get('/service/spare-parts', { params: params(q) })).data,
  createSparePart: async (input: CreateSparePartInput): Promise<SparePartDto> => (await apiClient.post('/service/spare-parts', input)).data,
  updateSparePart: async (id: string, input: UpdateSparePartInput): Promise<SparePartDto> => (await apiClient.patch(`/service/spare-parts/${id}`, input)).data,
  adjustSparePart: async (id: string, delta: number): Promise<SparePartDto> => (await apiClient.post(`/service/spare-parts/${id}/adjust`, { delta })).data,
  removeSparePart: async (id: string): Promise<void> => { await apiClient.delete(`/service/spare-parts/${id}`); },
  labourItems: async (): Promise<LabourItemDto[]> => (await apiClient.get('/service/labour-items')).data,
  createLabourItem: async (input: CreateLabourItemInput): Promise<LabourItemDto> => (await apiClient.post('/service/labour-items', input)).data,
  removeLabourItem: async (id: string): Promise<void> => { await apiClient.delete(`/service/labour-items/${id}`); },

  reports: async (): Promise<ServiceReports> => (await apiClient.get('/service/reports')).data,
};
