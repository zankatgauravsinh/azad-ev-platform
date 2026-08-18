import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const toneClass: Record<string, string> = {
  positive: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-destructive',
};

export function StatCard({
  label,
  value,
  hint,
  active,
  loading,
  onClick,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  active?: boolean;
  loading?: boolean;
  onClick?: () => void;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
}): JSX.Element {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card p-4 text-left shadow-sm transition-colors',
        onClick && 'hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-accent ring-1 ring-accent',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone && tone !== 'default' && toneClass[tone])}>{value}</p>
      )}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Comp>
  );
}
