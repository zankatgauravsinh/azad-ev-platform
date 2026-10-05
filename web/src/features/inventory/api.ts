import type {
  ChangeUnitStatusInput,
  CreateUnitInput,
  CsvImportResult,
  InventoryEventDto,
  InventoryStats,
  InventoryUnitDocumentDto,
  InventoryUnitDto,
  InventoryUnitPhotoDto,
  ListUnitsQuery,
  Paginated,
  UpdateUnitInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface ModelRef {
  id: string;
  name: string;
  brand: string;
  /** GST classification assigned to the model (null / absent = not classified). */
  taxClassificationId?: string | null;
}
export interface VariantOption {
  id: string;
  name: string;
  colour: string;
  hexColour: string | null;
  exShowroomPrice: string;
  model: ModelRef;
}

export interface InventoryDashboard {
  stats: InventoryStats;
  recentlyAdded: InventoryUnitDto[];
  reserved: InventoryUnitDto[];
  readyForDelivery: InventoryUnitDto[];
  lowInventory: { model: string; brand: string; available: number }[];
}

export interface UnitDetail extends InventoryUnitDto {
  events: InventoryEventDto[];
  photos: InventoryUnitPhotoDto[];
  documents: InventoryUnitDocumentDto[];
  bookings: { id: string; code: string; status: string; createdAt: string; customer: CustomerRef }[];
  sales: {
    id: string;
    invoiceNumber: string | null;
    status: string;
    total: string;
    createdAt: string;
    customer: CustomerRef;
  }[];
  serviceJobs: {
    id: string;
    code: string;
    status: string;
    complaint: string;
    createdAt: string;
    customer: CustomerRef;
  }[];
}

export interface CustomerRef {
  id: string;
  name: string;
  phone: string;
}

const buildParams = (query: Partial<ListUnitsQuery>): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== null) params[key] = String(value);
  }
  return params;
};

export const inventoryApi = {
  async list(query: Partial<ListUnitsQuery>): Promise<Paginated<InventoryUnitDto>> {
    const { data } = await apiClient.get('/inventory/units', { params: buildParams(query) });
    return data;
  },
  async stats(): Promise<InventoryStats> {
    const { data } = await apiClient.get('/inventory/stats');
    return data;
  },
  async dashboard(): Promise<InventoryDashboard> {
    const { data } = await apiClient.get('/inventory/dashboard');
    return data;
  },
  async getById(id: string): Promise<UnitDetail> {
    const { data } = await apiClient.get(`/inventory/units/${id}`);
    return data;
  },
  async events(id: string): Promise<InventoryEventDto[]> {
    const { data } = await apiClient.get(`/inventory/units/${id}/events`);
    return data;
  },
  async checkVin(vin: string): Promise<{ exists: boolean }> {
    const { data } = await apiClient.get('/inventory/units/check-vin', { params: { vin } });
    return data;
  },
  async create(input: CreateUnitInput): Promise<InventoryUnitDto> {
    const { data } = await apiClient.post('/inventory/units', input);
    return data;
  },
  async update(id: string, input: UpdateUnitInput): Promise<InventoryUnitDto> {
    const { data } = await apiClient.patch(`/inventory/units/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/inventory/units/${id}`);
  },
  async changeStatus(id: string, input: ChangeUnitStatusInput): Promise<InventoryUnitDto> {
    const { data } = await apiClient.patch(`/inventory/units/${id}/status`, input);
    return data;
  },
  async models(): Promise<ModelRef[]> {
    const { data } = await apiClient.get('/inventory/models');
    return data;
  },
  async variants(modelId?: string): Promise<VariantOption[]> {
    const { data } = await apiClient.get('/inventory/variants', { params: modelId ? { modelId } : {} });
    return data;
  },
  async createModel(name: string, brand: string): Promise<ModelRef> {
    const { data } = await apiClient.post('/inventory/models', { name, brand });
    return data;
  },
  async importCsv(file: File): Promise<CsvImportResult> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/inventory/units/import', form);
    return data;
  },
  async addPhoto(id: string, file: File, label?: string): Promise<InventoryUnitPhotoDto> {
    const form = new FormData();
    form.append('file', file);
    if (label) form.append('label', label);
    const { data } = await apiClient.post(`/inventory/units/${id}/photos`, form);
    return data;
  },
  async removePhoto(id: string, photoId: string): Promise<void> {
    await apiClient.delete(`/inventory/units/${id}/photos/${photoId}`);
  },
  async addDocument(id: string, file: File, type: string): Promise<InventoryUnitDocumentDto> {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    const { data } = await apiClient.post(`/inventory/units/${id}/documents`, form);
    return data;
  },
  async removeDocument(id: string, docId: string): Promise<void> {
    await apiClient.delete(`/inventory/units/${id}/documents/${docId}`);
  },
  async exportBlob(query: Partial<ListUnitsQuery>, format: 'xlsx' | 'pdf'): Promise<Blob> {
    const res = await apiClient.get('/inventory/units/export', {
      params: { ...buildParams(query), format },
      responseType: 'blob',
    });
    return res.data as Blob;
  },
};
