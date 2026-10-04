import type {
  CreateRoleInput,
  DuplicateRoleInput,
  ListRolesQuery,
  Paginated,
  RoleDetail,
  RoleListItem,
  UpdateRoleInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export type RolesQuery = Partial<ListRolesQuery>;

const params = (q: RolesQuery): Record<string, string> => {
  const out: Record<string, string> = { page: String(q.page ?? 1), pageSize: String(q.pageSize ?? 50) };
  if (q.type) out.type = q.type;
  if (q.q) out.q = q.q;
  if (q.order) out.order = q.order;
  return out;
};

/** Role management client. companyId is never sent — the backend derives it from the actor. */
export const rolesApi = {
  list: async (q: RolesQuery): Promise<Paginated<RoleListItem>> =>
    (await apiClient.get<Paginated<RoleListItem>>('/roles', { params: params(q) })).data,
  get: async (id: string): Promise<RoleDetail> => (await apiClient.get<RoleDetail>(`/roles/${id}`)).data,
  create: async (input: CreateRoleInput): Promise<RoleDetail> => (await apiClient.post<RoleDetail>('/roles', input)).data,
  update: async (id: string, input: UpdateRoleInput): Promise<RoleDetail> =>
    (await apiClient.patch<RoleDetail>(`/roles/${id}`, input)).data,
  updatePermissions: async (id: string, permissionKeys: string[]): Promise<RoleDetail> =>
    (await apiClient.put<RoleDetail>(`/roles/${id}/permissions`, { permissionKeys })).data,
  duplicate: async (id: string, input: DuplicateRoleInput): Promise<RoleDetail> =>
    (await apiClient.post<RoleDetail>(`/roles/${id}/duplicate`, input)).data,
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/roles/${id}`);
  },
};
