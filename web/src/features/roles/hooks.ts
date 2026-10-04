import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoleInput, DuplicateRoleInput, UpdateRoleInput } from '@azad/shared';
import { rolesApi, type RolesQuery } from './api';

const keys = {
  all: ['roles'] as const,
  list: (q: RolesQuery) => ['roles', 'list', q] as const,
  detail: (id: string) => ['roles', 'detail', id] as const,
};

export const useRoles = (q: RolesQuery, enabled = true) =>
  useQuery({ queryKey: keys.list(q), queryFn: () => rolesApi.list(q), enabled });
export const useRole = (id: string | undefined, enabled = true) =>
  useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => rolesApi.get(id as string), enabled: Boolean(id) && enabled });

export function useRoleMutations() {
  const qc = useQueryClient();
  const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }) };
  return {
    create: useMutation({ mutationFn: (input: CreateRoleInput) => rolesApi.create(input), ...opts }),
    update: useMutation({ mutationFn: (v: { id: string; input: UpdateRoleInput }) => rolesApi.update(v.id, v.input), ...opts }),
    updatePermissions: useMutation({ mutationFn: (v: { id: string; permissionKeys: string[] }) => rolesApi.updatePermissions(v.id, v.permissionKeys), ...opts }),
    duplicate: useMutation({ mutationFn: (v: { id: string; input: DuplicateRoleInput }) => rolesApi.duplicate(v.id, v.input), ...opts }),
    remove: useMutation({ mutationFn: (id: string) => rolesApi.remove(id), ...opts }),
  };
}
