import {
  LayoutDashboard,
  Users,
  PackageOpen,
  Zap,
  ClipboardList,
  IndianRupee,
  Bike,
  Wrench,
  Wallet,
  BarChart3,
  Settings,
  Home,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@azad/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** false until the owning module ships; rendered as a disabled "Soon" entry. */
  enabled: boolean;
  /** roles allowed to see the item; empty = all authenticated roles. */
  roles?: Role[];
}

/**
 * Sidebar structure mirrors the module roadmap. Items flip to `enabled: true`
 * as each module is delivered. Order matches the product spec.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', to: '/', icon: Home, enabled: true },
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, enabled: true, roles: ['OWNER', 'MANAGER'] },
  { label: 'Customers', to: '/customers', icon: Users, enabled: true, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Inventory', to: '/inventory', icon: PackageOpen, enabled: true, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Test Rides', to: '/test-rides', icon: Zap, enabled: false, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Quotations', to: '/quotations', icon: IndianRupee, enabled: true, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Bookings', to: '/bookings', icon: ClipboardList, enabled: true, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Delivery', to: '/delivery', icon: Bike, enabled: false, roles: ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] },
  { label: 'Service', to: '/service', icon: Wrench, enabled: false, roles: ['OWNER', 'MANAGER', 'TECHNICIAN'] },
  { label: 'Expenses', to: '/expenses', icon: Wallet, enabled: false, roles: ['OWNER', 'MANAGER'] },
  { label: 'Reports', to: '/reports', icon: BarChart3, enabled: false, roles: ['OWNER', 'MANAGER'] },
  { label: 'Settings', to: '/settings', icon: Settings, enabled: true, roles: ['OWNER', 'MANAGER'] },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
