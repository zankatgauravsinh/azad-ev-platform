import type { TaxClassificationDto, TaxClassificationRef } from '@azad/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix Select cannot hold an empty value, so "nothing chosen" needs a sentinel. */
export const NO_CLASSIFICATION = '__none__';

/**
 * Picks one of the company's ACTIVE tax classifications, or none. There is no default: an unset value
 * shows the `noneLabel` and stays unset until someone chooses.
 */
export function ClassificationSelect({
  name,
  value,
  options,
  current,
  noneLabel,
  disabled,
  onChange,
}: {
  /** Identifies the field (also its accessible name in tests). */
  name: string;
  value: string | null;
  options: TaxClassificationDto[];
  /** The currently assigned classification when it is no longer among the active options. */
  current?: TaxClassificationRef | null;
  noneLabel: string;
  disabled?: boolean;
  onChange: (classificationId: string | null) => void;
}): JSX.Element {
  const orphan = value !== null && !options.some((o) => o.id === value);
  return (
    <Select name={name} value={value ?? NO_CLASSIFICATION} disabled={disabled} onValueChange={(v) => onChange(v === NO_CLASSIFICATION ? null : v)}>
      <SelectTrigger className="h-9 w-full sm:w-64"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CLASSIFICATION}>{noneLabel}</SelectItem>
        {orphan && <SelectItem value={value}>{current?.name ?? 'Unavailable classification'} (inactive)</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.name}{o.code ? ` · ${o.codeType} ${o.code}` : ''}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
