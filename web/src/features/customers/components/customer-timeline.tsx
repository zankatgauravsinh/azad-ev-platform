import { useState } from 'react';
import { History } from 'lucide-react';
import { CUSTOMER_EVENT_TYPES, type CustomerEventType } from '@azad/shared';
import { eventTypeLabel } from '@/lib/labels';
import { EmptyState } from '@/components/common/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCustomerTimeline } from '../hooks';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function CustomerTimeline({ customerId }: { customerId: string }): JSX.Element {
  const [filter, setFilter] = useState<CustomerEventType | 'ALL'>('ALL');
  const { data: entries = [], isLoading } = useCustomerTimeline(customerId, filter === 'ALL' ? undefined : filter);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={filter} onValueChange={(v) => setFilter(v as CustomerEventType | 'ALL')}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All events</SelectItem>
            {CUSTOMER_EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeLabel(t)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!isLoading && entries.length === 0 ? (
        <EmptyState icon={History} title="No timeline entries" description="Events appear here automatically." />
      ) : (
        <ol className="relative space-y-4 border-l pl-6">
          {entries.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-accent bg-background" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-accent">{eventTypeLabel(e.type)}</span>
              </div>
              <p className="text-sm font-medium">{e.title}</p>
              {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{fmt(e.occurredAt)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
