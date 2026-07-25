import type { MonthlyPoint } from '@azad/shared';
import { formatCompactPaise } from '@/lib/money';

/** Lightweight SVG bar chart for monthly amounts — no chart-library dependency. */
export function BarChart({ points, tone = 'accent' }: { points: MonthlyPoint[]; tone?: 'accent' | 'primary' }): JSX.Element {
  const values = points.map((p) => Number(p.amount));
  const max = Math.max(1, ...values);
  const barColor = tone === 'accent' ? 'hsl(var(--accent))' : 'hsl(var(--primary))';

  return (
    <div className="flex h-40 items-end justify-between gap-2">
      {points.map((p) => {
        const h = (Number(p.amount) / max) * 100;
        return (
          <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{formatCompactPaise(p.amount)}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md transition-all"
                style={{ height: `${Math.max(h, 2)}%`, backgroundColor: barColor, opacity: h === 0 ? 0.25 : 1 }}
                title={`${p.label}: ${formatCompactPaise(p.amount)} (${p.count})`}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}
