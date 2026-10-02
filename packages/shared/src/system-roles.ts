import { Role } from './enums';
import { PERMISSION_KEYS } from './permissions';

/**
 * System-role definitions + their permission bundles (Group 2 — seed data).
 *
 * These reproduce the EXACT current authorization behavior of the five fixed roles so that when
 * authorization later switches to RBAC, nothing changes. The five roles are seeded as locked
 * system roles (isSystem=true); OWNER is additionally protected. The legacy `User.role` enum and
 * `@Roles`/`RolesGuard` remain authoritative until a later migration group.
 */

export interface SystemRoleDef {
  /** Stable key == the legacy enum value. */
  key: Role;
  /** Display name (equal to the enum value for the seeded roles). */
  name: string;
  isProtected: boolean;
}

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  { key: Role.OWNER, name: 'OWNER', isProtected: true },
  { key: Role.MANAGER, name: 'MANAGER', isProtected: false },
  { key: Role.SALES_EXECUTIVE, name: 'SALES_EXECUTIVE', isProtected: false },
  { key: Role.TECHNICIAN, name: 'TECHNICIAN', isProtected: false },
  { key: Role.ACCOUNTANT, name: 'ACCOUNTANT', isProtected: false },
];

/** OWNER-only capabilities — the only keys MANAGER does NOT receive. */
const OWNER_ONLY = new Set<string>(['settings.manage', 'staff.manage', 'roles.manage']);

// SALES_EXECUTIVE: full sales cycle + read-only Service + search/notifications (current behavior).
const SALES_EXECUTIVE_PERMISSIONS: readonly string[] = [
  'customers.view', 'customers.create', 'customers.update',
  'inventory.view',
  'quotations.view', 'quotations.create', 'quotations.update', 'quotations.convert', 'quotations.delete',
  'bookings.view', 'bookings.create', 'bookings.update', 'bookings.cancel', 'bookings.payment', 'bookings.invoice',
  'delivery.view', 'delivery.manage',
  'returns.view', 'returns.create',
  'service.view',
  'warranty.view', 'amc.view', 'claims.view',
  'search.use', 'notifications.use',
  'accessories.view',
  'settings.branding',
];

// TECHNICIAN: service workflow (no front-desk/billing) + warranty/amc/claims + notifications.
const TECHNICIAN_PERMISSIONS: readonly string[] = [
  'service.view', 'service.workflow', 'service.parts', 'service.labour',
  'spareparts.view', 'labour.view',
  'warranty.view', 'warranty.create', 'warranty.update',
  'amc.view', 'amc.manage',
  'claims.view', 'claims.manage',
  'notifications.use',
  'settings.branding',
];

// ACCOUNTANT: finance family only. No notifications/search/dashboard/inventory/returns/staff.
const ACCOUNTANT_PERMISSIONS: readonly string[] = [
  'finance.view', 'finance.manage',
  'expenses.view', 'expenses.manage',
  'bank.view', 'bank.manage',
  'income.view', 'income.manage',
  'vendors.view', 'vendors.manage',
];

/** Role → granted permission keys. OWNER = full catalog; MANAGER = full catalog minus OWNER-only. */
export const SYSTEM_ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  [Role.OWNER]: [...PERMISSION_KEYS],
  [Role.MANAGER]: PERMISSION_KEYS.filter((k) => !OWNER_ONLY.has(k)),
  [Role.SALES_EXECUTIVE]: SALES_EXECUTIVE_PERMISSIONS,
  [Role.TECHNICIAN]: TECHNICIAN_PERMISSIONS,
  [Role.ACCOUNTANT]: ACCOUNTANT_PERMISSIONS,
};
