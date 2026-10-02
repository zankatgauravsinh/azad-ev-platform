/**
 * System-defined permission catalog for dynamic RBAC (Group 1 — definition only).
 *
 * Permissions are SYSTEM-DEFINED: the Owner composes them into custom roles but can never
 * invent new keys. Each key is `module.action`. This catalog is the single source of truth for
 * the (later) Permission table seed, the backend PermissionsGuard, and the frontend `can()` helper.
 *
 * Group 1 defines the catalog only — it does NOT seed roles, assign permissions, or change any
 * authorization behavior. The existing `@Roles(...)` system and `User.role` enum remain the live
 * authority until later migration groups.
 */

/** A single system-defined permission. */
export interface PermissionDef {
  /** Globally-unique key, `module.action`, e.g. `customers.create`. */
  key: string;
  /** Module slug used to group permissions in the UI. */
  module: PermissionModule;
  /** Action slug within the module. */
  action: string;
  /** Human-readable label for the Role editor UI. */
  label: string;
  /** Sensitive capability (money, deletion, admin) — surfaced with a warning in the UI. */
  isDangerous: boolean;
}

/** Module slugs, in display order. */
export const PERMISSION_MODULES = [
  'customers',
  'inventory',
  'quotations',
  'bookings',
  'delivery',
  'returns',
  'service',
  'spareparts',
  'labour',
  'warranty',
  'amc',
  'claims',
  'finance',
  'expenses',
  'bank',
  'income',
  'vendors',
  'reports',
  'dashboard',
  'search',
  'notifications',
  'accessories',
  'settings',
  'staff',
  'roles',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

// Compact definition rows: [action, label, isDangerous?]. Keys are derived as `${module}.${action}`.
type Row = [action: string, label: string, dangerous?: boolean];
const MODULE_ROWS: Record<PermissionModule, Row[]> = {
  customers: [
    ['view', 'View customers'],
    ['create', 'Create customers'],
    ['update', 'Edit customers'],
    ['delete', 'Delete customers', true],
  ],
  inventory: [
    ['view', 'View inventory'],
    ['create', 'Add inventory'],
    ['update', 'Edit inventory'],
    ['delete', 'Delete inventory', true],
    ['status', 'Change unit status'],
  ],
  quotations: [
    ['view', 'View quotations'],
    ['create', 'Create quotations'],
    ['update', 'Edit quotations'],
    ['convert', 'Convert quotation to booking'],
    ['delete', 'Delete quotations', true],
  ],
  bookings: [
    ['view', 'View bookings'],
    ['create', 'Create bookings'],
    ['update', 'Edit bookings'],
    ['cancel', 'Cancel bookings', true],
    ['payment', 'Record booking payment', true],
    ['invoice', 'Generate invoice'],
  ],
  delivery: [
    ['view', 'View deliveries'],
    ['manage', 'Manage delivery'],
  ],
  returns: [
    ['view', 'View returns'],
    ['create', 'Request return'],
    ['inspect', 'Inspect return'],
    ['approve', 'Approve return', true],
    ['reject', 'Reject return'],
    ['cancel', 'Cancel return'],
    ['complete', 'Complete return (refund)', true],
  ],
  service: [
    ['view', 'View service jobs'],
    ['create', 'Create job card'],
    ['assign', 'Assign technician'],
    ['workflow', 'Service workflow'],
    ['parts', 'Add/remove parts'],
    ['labour', 'Add/remove labour'],
    ['bill', 'Generate service bill', true],
    ['payment', 'Take service payment', true],
  ],
  spareparts: [
    ['view', 'View spare parts'],
    ['manage', 'Manage spare parts', true],
    ['adjust', 'Adjust spare-part stock', true],
  ],
  labour: [
    ['view', 'View labour catalogue'],
    ['manage', 'Manage labour catalogue'],
  ],
  warranty: [
    ['view', 'View warranties'],
    ['create', 'Create/generate warranty'],
    ['update', 'Edit warranty / free service'],
    ['cancel', 'Cancel warranty', true],
  ],
  amc: [
    ['view', 'View AMC'],
    ['manage', 'Manage AMC'],
  ],
  claims: [
    ['view', 'View warranty claims'],
    ['manage', 'Manage warranty claims'],
  ],
  finance: [
    ['view', 'View finance'],
    ['manage', 'Manage finance', true],
  ],
  expenses: [
    ['view', 'View expenses'],
    ['manage', 'Manage expenses', true],
  ],
  bank: [
    ['view', 'View bank transactions'],
    ['manage', 'Manage bank transactions', true],
  ],
  income: [
    ['view', 'View income'],
    ['manage', 'Manage income', true],
  ],
  vendors: [
    ['view', 'View vendors'],
    ['manage', 'Manage vendors'],
  ],
  reports: [['view', 'View & export reports']],
  dashboard: [['view', 'View dashboard']],
  search: [['use', 'Use global search']],
  notifications: [['use', 'Use notifications']],
  accessories: [
    ['view', 'View accessories'],
    ['manage', 'Manage accessories'],
  ],
  settings: [
    ['view', 'View company settings'],
    ['manage', 'Manage company settings', true],
    ['branding', 'View company branding'],
  ],
  staff: [['manage', 'Manage staff', true]],
  roles: [['manage', 'Manage roles & permissions', true]],
};

/** The full system permission catalog, ordered by module then declaration order. */
export const PERMISSIONS: readonly PermissionDef[] = PERMISSION_MODULES.flatMap((module) =>
  MODULE_ROWS[module].map(([action, label, dangerous]) => ({
    key: `${module}.${action}`,
    module,
    action,
    label,
    isDangerous: dangerous ?? false,
  })),
);

/** All permission keys, in catalog order. */
export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

/** Fast membership/set helpers for guards and tests. */
export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export const isPermissionKey = (value: string): boolean => PERMISSION_KEY_SET.has(value);
