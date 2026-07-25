import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, CalendarClock, Clock, FileClock, PackageX, Shield, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TodaysWork } from '@azad/shared';
import { formatCompactPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Tile {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  tone: 'default' | 'warn' | 'danger';
  href: string;
}

export function TodayWork({ data }: { data: TodaysWork }): JSX.Element {
  const navigate = useNavigate();
  const tiles: Tile[] = [
    { label: "Today's Deliveries", value: data.deliveries, icon: CalendarClock, tone: 'default', href: '/bookings' },
    { label: "Today's Follow-ups", value: data.followUps, icon: Clock, tone: data.followUps > 0 ? 'warn' : 'default', href: '/customers' },
    { label: 'Pending Payments', value: data.pendingPayments.count, sub: formatCompactPaise(data.pendingPayments.amount), icon: Banknote, tone: data.pendingPayments.count > 0 ? 'danger' : 'default', href: '/bookings' },
    { label: 'Pending Finance', value: data.pendingFinanceApprovals, icon: FileClock, tone: data.pendingFinanceApprovals > 0 ? 'warn' : 'default', href: '/bookings' },
    { label: 'Pending Insurance', value: data.pendingInsurance, icon: Shield, tone: data.pendingInsurance > 0 ? 'warn' : 'default', href: '/bookings' },
    { label: 'Service Due Today', value: data.serviceDueToday, icon: Wrench, tone: 'default', href: '/bookings' },
    { label: 'Low Inventory', value: data.lowInventory, icon: PackageX, tone: data.lowInventory > 0 ? 'warn' : 'default', href: '/inventory' },
    { label: 'Overdue Bookings', value: data.overdueBookings, icon: AlertTriangle, tone: data.overdueBookings > 0 ? 'danger' : 'default', href: '/bookings' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => navigate(t.href)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-accent/60',
              t.tone === 'danger' && Number(t.value) > 0 && 'border-destructive/40',
              t.tone === 'warn' && Number(t.value) > 0 && 'border-amber-500/40',
            )}
          >
            <Icon className={cn('h-4 w-4', t.tone === 'danger' && Number(t.value) > 0 ? 'text-destructive' : t.tone === 'warn' && Number(t.value) > 0 ? 'text-amber-500' : 'text-muted-foreground')} />
            <span className="text-2xl font-bold tabular-nums">{t.value}</span>
            <span className="text-xs text-muted-foreground">{t.label}{t.sub ? ` · ${t.sub}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
