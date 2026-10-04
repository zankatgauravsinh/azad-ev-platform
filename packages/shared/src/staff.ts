import { z } from 'zod';
import { Role, ROLES } from './enums';
import { paginationQuerySchema } from './pagination';

/**
 * Staff Management contracts (OWNER-only feature). Uses the existing fixed Role enum —
 * no dynamic RBAC. Mirrors the password strength rule used by changePassword so an
 * owner-set temporary password meets the same bar.
 */
const staffPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

const roleEnum = z.enum(ROLES as [Role, ...Role[]]);

export const createStaffSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).optional(),
  // `role` is the legacy base role (kept for display/back-compat). `roleId` optionally assigns a
  // specific company role (a custom role, or any system role) — it drives effective permissions.
  role: roleEnum,
  roleId: z.string().uuid().optional(),
  password: staffPassword,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/** Profile + role edit. At least one field must be present. */
export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    role: roleEnum.optional(),
    roleId: z.string().uuid().optional(),
  })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.role !== undefined || v.roleId !== undefined, {
    message: 'No changes provided',
  });
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const setStaffActiveSchema = z.object({ isActive: z.boolean() });
export type SetStaffActiveInput = z.infer<typeof setStaffActiveSchema>;

/** Admin (OWNER) resets a staff member's password to a new value. */
export const resetStaffPasswordSchema = z.object({ password: staffPassword });
export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>;

export const listStaffQuerySchema = paginationQuerySchema.extend({
  role: roleEnum.optional(),
  // Query param arrives as a string; coerce safely (z.coerce.boolean would treat "false" as true).
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

/** Client-safe staff shape — never exposes passwordHash or refreshTokenHash. */
export interface StaffDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Legacy base role enum — kept for back-compat / coarse filtering. */
  role: Role;
  /** The assigned company AppRole id (system or custom); drives effective permissions. */
  roleId: string | null;
  /** The assigned AppRole's display name (e.g. "Manager" or a custom role name). */
  roleName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
