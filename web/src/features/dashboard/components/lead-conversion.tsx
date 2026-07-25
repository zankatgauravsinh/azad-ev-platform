import { LEAD_STATUSES, type LeadStatus } from '@azad/shared';
import { leadStatusLabel } from '@/lib/labels';

/** Horizontal funnel of customers by lead status. */
export function LeadConversion({ data }: { data: { status: LeadStatus; count: number }[] }): JSX.Element {
  const byStatus = new Map(data.map((d) => [d.status, d.count]));
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="space-y-2">
      {LEAD_STATUSES.map((s) => {
        const count = byStatus.get(s) ?? 0;
        return (
          <div key={s} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{leadStatusLabel(s)}</span>
            <div className="flex-1">
              <div className="h-4 rounded bg-accent/80" style={{ width: `${Math.max((count / max) * 100, count > 0 ? 6 : 0)}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
