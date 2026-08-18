import { IndianRupee, Info, PackageOpen, ShieldCheck, Truck, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { NotificationPriority, NotificationType } from '@azad/shared';

export const priorityMeta: Record<NotificationPriority, { label: string; dot: string; text: string }> = {
  CRITICAL: { label: 'Critical', dot: 'bg-red-500', text: 'text-red-600' },
  HIGH: { label: 'High', dot: 'bg-orange-500', text: 'text-orange-600' },
  MEDIUM: { label: 'Medium', dot: 'bg-blue-500', text: 'text-blue-600' },
  LOW: { label: 'Low', dot: 'bg-gray-400', text: 'text-muted-foreground' },
};

export const categoryMeta: Record<NotificationType, { label: string; icon: LucideIcon }> = {
  DELIVERY: { label: 'Delivery', icon: Truck },
  PAYMENT: { label: 'Payment', icon: IndianRupee },
  SERVICE: { label: 'Service', icon: Wrench },
  INVENTORY: { label: 'Inventory', icon: PackageOpen },
  CUSTOMER: { label: 'Customer', icon: Users },
  WARRANTY: { label: 'Warranty', icon: ShieldCheck },
  SYSTEM: { label: 'System', icon: Info },
};

/** Group an ISO timestamp into Today / Yesterday / Earlier. */
export function dateGroup(iso: string): 'Today' | 'Yesterday' | 'Earlier' {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return 'Today';
  if (t >= startToday - 86_400_000) return 'Yesterday';
  return 'Earlier';
}

/** Compact relative time, e.g. "3h", "2d". */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
