import { Banknote, Bike, FileText, PackageCheck, Shield, ShoppingCart, Truck, UserPlus, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CustomerEventType, type RecentActivityItem } from '@azad/shared';
import { EmptyState } from '@/components/common/empty-state';

const ICONS: Partial<Record<CustomerEventType, LucideIcon>> = {
  [CustomerEventType.BOOKING]: ShoppingCart,
  [CustomerEventType.ADVANCE_PAYMENT]: Banknote,
  [CustomerEventType.VEHICLE_ASSIGNED]: Bike,
  [CustomerEventType.DELIVERY]: Truck,
  [CustomerEventType.FINANCE_APPROVED]: PackageCheck,
  [CustomerEventType.INSURANCE_ADDED]: Shield,
  [CustomerEventType.LEAD_CREATED]: UserPlus,
  [CustomerEventType.FIRST_SERVICE]: Wrench,
  [CustomerEventType.INVOICE_GENERATED]: FileText,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }): JSX.Element {
  if (items.length === 0) return <EmptyState title="No recent activity" description="Actions across the showroom appear here." />;
  return (
    <ul className="space-y-3">
      {items.map((a) => {
        const Icon = ICONS[a.type] ?? ShoppingCart;
        return (
          <li key={a.id} className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-secondary p-1.5"><Icon className="h-3.5 w-3.5 text-accent" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.customer?.name ?? '—'} · {timeAgo(a.occurredAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
