import { ArrowRight } from 'lucide-react';
import type { AuditValue } from '@azad/shared';
import { formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

/** Field names whose values are money in paise, by their last word ("sellingPrice" → price); rates, days and counts are not. */
const MONEY_WORDS = new Set(['price', 'cost', 'amount', 'discount', 'paid', 'balance', 'total', 'charge', 'premium', 'advance', 'showroom', 'subtotal', 'fee', 'refund', 'deduction', 'gst', 'cash', 'bank']);
const lastWord = (field: string): string => (field.match(/[A-Z]?[a-z0-9]+$/)?.[0] ?? field).toLowerCase();
const isMoneyField = (field: string): boolean => MONEY_WORDS.has(lastWord(field));

/** "sellingPrice" → "Selling price". */
export function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A stored value as people read it: ₹ for money, Yes / No, — for empty. */
export function showValue(field: string, value: AuditValue): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (isMoneyField(field) && /^-?\d+$/.test(String(value))) return formatPaise(String(value));
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return String(value);
}

/** What changed: each field with its old value struck through and the new one, or the value set on a new record. */
export function ChangeList({ changes, compact = false }: { changes: Record<string, { from: AuditValue; to: AuditValue }> | null; compact?: boolean }): JSX.Element | null {
  const rows = Object.entries(changes ?? {});
  if (!rows.length) return null;
  return (
    <dl className={cn('space-y-1', compact ? 'text-xs' : 'text-sm')} aria-label="Changes">
      {rows.map(([field, { from, to }]) => (
        <div key={field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <dt className="min-w-[8rem] text-muted-foreground">{fieldLabel(field)}</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {from !== null && <span className="font-mono text-muted-foreground line-through">{showValue(field, from)}</span>}
            {from !== null && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="changed to" />}
            <span className="font-mono font-semibold">{showValue(field, to)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
