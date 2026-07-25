import type { InventoryEventDto } from '@azad/shared';
import { unitStatusLabel } from '@/lib/labels';
import { EmptyState } from '@/components/common/empty-state';
import { History } from 'lucide-react';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function UnitTimeline({ events }: { events: InventoryEventDto[] }): JSX.Element {
  if (events.length === 0) {
    return <EmptyState icon={History} title="No history yet" />;
  }

  return (
    <ol className="relative space-y-4 border-l pl-6">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-accent bg-background" />
          <p className="text-sm font-medium">
            {event.fromStatus
              ? `${unitStatusLabel(event.fromStatus)} → ${unitStatusLabel(event.toStatus)}`
              : `Purchased — ${unitStatusLabel(event.toStatus)}`}
          </p>
          {event.note && <p className="text-sm text-muted-foreground">{event.note}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}
