import { z } from 'zod';
import { paginationQuerySchema } from './pagination';

/**
 * Role management API contracts (Group 3B). Permissions are identified by KEY (from the global
 * permission catalog); the backend resolves keys → Permission records and rejects unknown keys.
 * companyId is NEVER part of any input — it is derived from the authenticated actor server-side.
 */
const roleName = z.string().trim().min(2, 'Role name must be at least 2 characters').max(60, 'Role name must be at most 60 characters');
const roleDescription = z.string().trim().max(200, 'Description must be at most 200 characters').nullish();
const permissionKeys = z.array(z.string());

export const createRoleSchema = z.object({
  name: roleName,
  description: roleDescription,
  permissionKeys,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * Partial edit of a custom role's PROFILE only (name / description); at least one field required.
 * Permissions are managed solely via PUT /roles/:id/permissions (updateRolePermissionsSchema) —
 * PATCH intentionally does not accept permissionKeys, so there is one clear permission endpoint.
 */
export const updateRoleSchema = z
  .object({
    name: roleName.optional(),
    description: roleDescription,
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, { message: 'No changes provided' });
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const duplicateRoleSchema = z.object({ name: roleName, description: roleDescription });
export type DuplicateRoleInput = z.infer<typeof duplicateRoleSchema>;

/** Complete-replacement permission update: the array IS the entire permission set ([] clears it). */
export const updateRolePermissionsSchema = z.object({ permissionKeys });
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;

export const listRolesQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['system', 'custom']).optional(),
});
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;

/** Client-safe role row for the Roles list. */
export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isProtected: boolean;
  assignedUserCount: number;
  permissionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Role detail — includes the granted permission keys; never exposes user PII. */
export interface RoleDetail extends Omit<RoleListItem, 'permissionCount'> {
  permissionKeys: string[];
}
