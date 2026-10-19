import { VENDOR_TYPE_LABEL, type VendorOptionDto } from '@azad/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useVendorOptions } from '../hooks';

export const NO_VENDOR = '__none__';

/**
 * Pick a vendor from the company's list. Inactive vendors are left out unless one is already chosen (an old
 * record keeps showing its vendor). `value` is a vendor id, or NO_VENDOR.
 */
export function VendorSelect({
  value,
  onChange,
  id,
  allowNone = true,
  noneLabel = 'No vendor',
  placeholder = 'Select a vendor',
  disabled,
  prefer,
}: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** List vendors of this kind first (e.g. scooter suppliers on the scooter form). */
  prefer?: VendorOptionDto['type'];
}): JSX.Element {
  const { data } = useVendorOptions();
  const vendors = (data?.vendors ?? [])
    .filter((v) => v.status === 'ACTIVE' || v.id === value)
    .sort((a, b) => Number(prefer ? b.type === prefer : 0) - Number(prefer ? a.type === prefer : 0) || a.name.localeCompare(b.name));
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Vendor">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NO_VENDOR}>{noneLabel}</SelectItem>}
        {vendors.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name} · {v.vendorNumber}
            {v.type !== 'OTHER' ? ` · ${VENDOR_TYPE_LABEL[v.type]}` : ''}
            {v.status === 'INACTIVE' ? ' (inactive)' : ''}
            {v.id === data?.defaultScooterVendorId ? ' ★' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
