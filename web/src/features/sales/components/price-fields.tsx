import type { UseFormRegister } from 'react-hook-form';
import { formatPaise } from '@/lib/money';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/form-field';

export interface PriceValues {
  exShowroom: number;
  discount: number;
  exchangeValue: number;
  rto: number;
  insurance: number;
  registration: number;
  extendedWarranty: number;
}

const FIELDS: { key: keyof PriceValues; label: string; negative?: boolean }[] = [
  { key: 'exShowroom', label: 'Ex-showroom' },
  { key: 'discount', label: 'Discount', negative: true },
  { key: 'exchangeValue', label: 'Exchange', negative: true },
  { key: 'rto', label: 'RTO' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'registration', label: 'Registration' },
  { key: 'extendedWarranty', label: 'Extended warranty' },
];

/** On-road total in rupees, before clamping — negative when discount and exchange exceed the price. */
export function rawOnRoad(v: PriceValues, accessoriesRupees = 0): number {
  return (
    Number(v.exShowroom || 0) -
    Number(v.discount || 0) -
    Number(v.exchangeValue || 0) +
    accessoriesRupees +
    Number(v.rto || 0) +
    Number(v.insurance || 0) +
    Number(v.registration || 0) +
    Number(v.extendedWarranty || 0)
  );
}

/** On-road total in rupees for the live preview (never below zero). */
export function computeOnRoad(v: PriceValues, accessoriesRupees = 0): number {
  const t = rawOnRoad(v, accessoriesRupees);
  return t > 0 ? t : 0;
}

export function PriceFields({
  register,
  values,
  accessoriesRupees = 0,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  values: PriceValues;
  accessoriesRupees?: number;
}): JSX.Element {
  const total = computeOnRoad(values, accessoriesRupees);
  // The server refuses a negative total; say so here rather than showing ₹0.
  const negative = rawOnRoad(values, accessoriesRupees) < 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <FormField key={f.key} label={`${f.label} (₹)${f.negative ? ' −' : ''}`}>
            <Input type="number" min={0} step={1} {...register(f.key, { valueAsNumber: true })} />
          </FormField>
        ))}
        {accessoriesRupees > 0 && (
          <FormField label="Accessories (₹)">
            <Input value={accessoriesRupees} disabled />
          </FormField>
        )}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-2">
        <span className="text-sm font-medium">On-road total (estimate)</span>
        <span className={negative ? 'text-lg font-bold tabular-nums text-destructive' : 'text-lg font-bold tabular-nums'}>{negative ? `−${formatPaise(-rawOnRoad(values, accessoriesRupees) * 100)}` : formatPaise(total * 100)}</span>
      </div>
      {negative && <p role="alert" className="text-xs text-destructive">Discount and exchange value exceed the on-road price — check the figures.</p>}
    </div>
  );
}
