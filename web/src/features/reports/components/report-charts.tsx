import type { NamedAmount, DailyPoint } from '@azad/shared';
import { formatPaise, formatCompactPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';

/** Ranked horizontal bars — payment methods, model sales, etc. */
export function HBarList({ items, emptyLabel = 'No data' }: { items: NamedAmount[]; emptyLabel?: string }): JSX.Element {
  const max = Math.max(1, ...items.map((i) => Number(i.amount)));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.name}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">{titleCase(i.name)}</span>
            <span className="tabular-nums text-muted-foreground">{formatPaise(i.amount)} · {i.count}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${Math.max((Number(i.amount) / max) * 100, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact vertical bars for a daily series (no per-bar labels — reads at a glance). */
export function DailyBars({ points }: { points: DailyPoint[] }): JSX.Element {
  const max = Math.max(1, ...points.map((p) => Number(p.amount)));
  return (
    <div>
      <div className="flex h-32 items-end justify-between gap-1">
        {points.map((p) => (
          <div key={p.date} className="flex flex-1 flex-col items-center" title={`${p.label}: ${formatPaise(p.amount)}`}>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-primary transition-all"
                style={{ height: `${Math.max((Number(p.amount) / max) * 100, 2)}%`, opacity: Number(p.amount) === 0 ? 0.25 : 1 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span className="tabular-nums">peak {formatCompactPaise(String(max))}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}
