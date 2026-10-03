import {
  LayoutDashboard,
  Users,
  PackageOpen,
  Package,
  Zap,
  ClipboardList,
  IndianRupee,
  Bike,
  Wrench,
  ShieldCheck,
  Wallet,
  BarChart3,
  Settings,
  Home,
  Undo2,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@azad/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** false until the owning module ships; rendered as a disabled "Soon" entry. */
  enabled: boolean;
  /**
   * Effective-permission key required to see the item (RBAC migration). When set it takes
   * precedence over `roles` and is evaluated against the user's `can()` from /auth/me.
   */
  permission?: string;
  /**
   * LEGACY role gate — still used by nav items whose module has not yet been migrated to
   * permissions (later batches). Ignored when `permission` is set. Empty = all authenticated roles.
   */
  roles?: Role[];
}

/**
 * Sidebar structure mirrors the module roadmap. Items flip to `enabled: true`
 * as each module is delivered. Order matches the product spec.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', to: '/', icon: Home, enabled: true },
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, enabled: true, permission: 'dashboard.view' },
  { label: 'Customers', to: '/customers', icon: Users, enabled: true, permission: 'customers.view' },
  { label: 'Inventory', to: '/inventory', icon: PackageOpen, enabled: true, permission: 'inventory.view' },
  { label: 'Test Rides', to: '/test-rides', icon: Zap, enabled: false, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Quotations', to: '/quotations', icon: IndianRupee, enabled: true, permission: 'quotations.view' },
  { label: 'Bookings', to: '/bookings', icon: ClipboardList, enabled: true, permission: 'bookings.view' },
  { label: 'Delivery', to: '/delivery', icon: Bike, enabled: true, permission: 'delivery.view' },
  { label: 'Returns', to: '/returns', icon: Undo2, enabled: true, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Service', to: '/service', icon: Wrench, enabled: true, roles: ['OWNER', 'MANAGER', 'TECHNICIAN', 'SALES_EXECUTIVE'] },
  { label: 'Spare Parts', to: '/service/spare-parts', icon: Package, enabled: true, permission: 'spareparts.view' },
  { label: 'Warranty & AMC', to: '/warranty', icon: ShieldCheck, enabled: true, permission: 'warranty.view' },
  { label: 'Finance', to: '/finance', icon: Wallet, enabled: true, roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
  { label: 'Reports', to: '/reports', icon: BarChart3, enabled: true, permission: 'reports.view' },
  { label: 'Staff', to: '/staff', icon: UserCog, enabled: true, roles: ['OWNER'] },
  { label: 'Settings', to: '/settings', icon: Settings, enabled: true, permission: 'settings.view' },
];

/**
 * Nav visibility. Permission-migrated items (`permission` set) are gated by the user's effective
 * permissions via `can()`; not-yet-migrated items fall back to the legacy `roles` list; an item with
 * neither is visible to all authenticated users.
 */
export function visibleNavItems(role: Role, can: (permission: string) => boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.permission) return can(item.permission);
    if (item.roles) return item.roles.includes(role);
    return true;
  });
}
