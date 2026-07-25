import type {
  ChangeLeadStatusInput,
  CreateCustomerInput,
  CreateFollowUpInput,
  CreateNoteInput,
  CustomerDocumentDto,
  CustomerDto,
  CustomerFollowUpDto,
  CustomerListItem,
  CustomerNoteDto,
  CustomerNoteRevisionDto,
  CustomerRelated,
  CustomerStats,
  CustomerTimelineEntryDto,
  FollowUpReminders,
  ListCustomersQuery,
  LogInteractionInput,
  Paginated,
  UpdateCustomerInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface ActivityEntry {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

const params = (query: Partial<ListCustomersQuery>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== null) out[k] = String(v);
  return out;
};

export const customersApi = {
  async stats(): Promise<CustomerStats> {
    return (await apiClient.get('/customers/stats')).data;
  },
  async list(query: Partial<ListCustomersQuery>): Promise<Paginated<CustomerListItem>> {
    return (await apiClient.get('/customers', { params: params(query) })).data;
  },
  async getById(id: string): Promise<CustomerDto> {
    return (await apiClient.get(`/customers/${id}`)).data;
  },
  async create(input: CreateCustomerInput): Promise<CustomerDto> {
    return (await apiClient.post('/customers', input)).data;
  },
  async update(id: string, input: UpdateCustomerInput): Promise<CustomerDto> {
    return (await apiClient.patch(`/customers/${id}`, input)).data;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/customers/${id}`);
  },
  async changeStatus(id: string, input: ChangeLeadStatusInput): Promise<CustomerDto> {
    return (await apiClient.patch(`/customers/${id}/status`, input)).data;
  },
  async logInteraction(id: string, input: LogInteractionInput): Promise<void> {
    await apiClient.post(`/customers/${id}/interactions`, input);
  },
  async timeline(id: string, type?: string): Promise<CustomerTimelineEntryDto[]> {
    return (await apiClient.get(`/customers/${id}/timeline`, { params: type ? { type } : {} })).data;
  },
  async related(id: string): Promise<CustomerRelated> {
    return (await apiClient.get(`/customers/${id}/related`)).data;
  },
  async activity(id: string): Promise<ActivityEntry[]> {
    return (await apiClient.get(`/customers/${id}/activity`)).data;
  },
  // Documents
  async documents(id: string): Promise<CustomerDocumentDto[]> {
    return (await apiClient.get(`/customers/${id}/documents`)).data;
  },
  async addDocument(id: string, file: File, type: string): Promise<CustomerDocumentDto> {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    return (await apiClient.post(`/customers/${id}/documents`, form)).data;
  },
  async replaceDocument(id: string, docId: string, file: File): Promise<CustomerDocumentDto> {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.patch(`/customers/${id}/documents/${docId}`, form)).data;
  },
  async removeDocument(id: string, docId: string): Promise<void> {
    await apiClient.delete(`/customers/${id}/documents/${docId}`);
  },
  // Notes
  async notes(id: string): Promise<CustomerNoteDto[]> {
    return (await apiClient.get(`/customers/${id}/notes`)).data;
  },
  async createNote(id: string, input: CreateNoteInput): Promise<CustomerNoteDto> {
    return (await apiClient.post(`/customers/${id}/notes`, input)).data;
  },
  async updateNote(id: string, noteId: string, body: string): Promise<CustomerNoteDto> {
    return (await apiClient.patch(`/customers/${id}/notes/${noteId}`, { body })).data;
  },
  async noteRevisions(id: string, noteId: string): Promise<CustomerNoteRevisionDto[]> {
    return (await apiClient.get(`/customers/${id}/notes/${noteId}/revisions`)).data;
  },
  async removeNote(id: string, noteId: string): Promise<void> {
    await apiClient.delete(`/customers/${id}/notes/${noteId}`);
  },
  // Follow-ups
  async followUps(id: string): Promise<CustomerFollowUpDto[]> {
    return (await apiClient.get(`/customers/${id}/follow-ups`)).data;
  },
  async createFollowUp(id: string, input: CreateFollowUpInput): Promise<CustomerFollowUpDto> {
    return (await apiClient.post(`/customers/${id}/follow-ups`, input)).data;
  },
  async completeFollowUp(id: string, followUpId: string): Promise<void> {
    await apiClient.post(`/customers/${id}/follow-ups/${followUpId}/complete`);
  },
  async cancelFollowUp(id: string, followUpId: string): Promise<void> {
    await apiClient.post(`/customers/${id}/follow-ups/${followUpId}/cancel`);
  },
  async reminders(): Promise<FollowUpReminders> {
    return (await apiClient.get('/customers/follow-ups/reminders')).data;
  },
};
