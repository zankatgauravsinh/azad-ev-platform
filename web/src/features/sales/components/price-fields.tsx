import type { UseFormRegister } from 'react-hook-form';
import { formatPaise } from '@/lib/money';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

/** On-road total in rupees for the live preview. */
export function computeOnRoad(v: PriceValues, accessoriesRupees = 0): number {
  const t =
    Number(v.exShowroom || 0) -
    Number(v.discount || 0) -
    Number(v.exchangeValue || 0) +
    accessoriesRupees +
    Number(v.rto || 0) +
    Number(v.insurance || 0) +
    Number(v.registration || 0) +
    Number(v.extendedWarranty || 0);
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label>{f.label} (₹){f.negative ? ' −' : ''}</Label>
            <Input type="number" min={0} step={1} {...register(f.key, { valueAsNumber: true })} />
          </div>
        ))}
        {accessoriesRupees > 0 && (
          <div className="space-y-1.5">
            <Label>Accessories (₹)</Label>
            <Input value={accessoriesRupees} disabled />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-2">
        <span className="text-sm font-medium">On-road total (estimate)</span>
        <span className="text-lg font-bold tabular-nums">{formatPaise(total * 100)}</span>
      </div>
    </div>
  );
}
