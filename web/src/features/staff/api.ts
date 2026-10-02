import type {
  CreateStaffInput,
  Paginated,
  Role,
  StaffDto,
  UpdateStaffInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

/** Client-side list filters. Mirrors the Group 3 backend contract: pagination + role + isActive only. */
export interface StaffQuery {
  page: number;
  pageSize: number;
  role?: Role;
  isActive?: boolean;
}

const params = (q: StaffQuery): Record<string, string> => {
  const out: Record<string, string> = { page: String(q.page), pageSize: String(q.pageSize) };
  if (q.role) out.role = q.role;
  if (q.isActive !== undefined) out.isActive = String(q.isActive); // backend parses the 'true'/'false' string
  return out;
};

export const staffApi = {
  async list(query: StaffQuery): Promise<Paginated<StaffDto>> {
    return (await apiClient.get('/users/staff', { params: params(query) })).data;
  },
  async create(input: CreateStaffInput): Promise<StaffDto> {
    return (await apiClient.post('/users/staff', input)).data;
  },
  async update(id: string, input: UpdateStaffInput): Promise<StaffDto> {
    return (await apiClient.patch(`/users/staff/${id}`, input)).data;
  },
  async setActive(id: string, isActive: boolean): Promise<StaffDto> {
    return (await apiClient.patch(`/users/staff/${id}/active`, { isActive })).data;
  },
  // Administrative password reset. The plaintext is passed straight through to the request body
  // and never returned, cached or logged; the backend hashes it and clears the target's sessions.
  async resetPassword(id: string, password: string): Promise<StaffDto> {
    return (await apiClient.post(`/users/staff/${id}/reset-password`, { password })).data;
  },
};
