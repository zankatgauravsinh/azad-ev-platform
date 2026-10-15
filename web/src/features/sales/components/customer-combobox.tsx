import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { customersApi } from '@/features/customers/api';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * Searchable customer picker. Shows the chosen customer's name and mobile; when the form opens with a customer
 * already set, that customer is looked up by id. Pass `id` so a <Label htmlFor> names the control.
 */
export function CustomerCombobox({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (id: string, label: string) => void;
  id?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const q = useDebounce(search);
  const { data } = useQuery({
    queryKey: ['customers', 'combobox', q],
    queryFn: () => customersApi.list({ q: q || undefined, pageSize: 8 }),
    enabled: open,
  });
  // A value set from outside (a pre-filled form) is shown by name once it has loaded.
  const known = picked?.id === value ? picked.label : null;
  const { data: preset } = useQuery({
    queryKey: ['customers', 'detail', value],
    queryFn: () => customersApi.getById(value),
    enabled: Boolean(value) && !known,
  });
  useEffect(() => { if (!value) setPicked(null); }, [value]);
  const label = known ?? (preset && preset.id === value ? `${preset.name} · ${preset.phone}` : null);
  const listId = id ? `${id}-options` : undefined;

  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? (label ?? 'Loading…') : 'Select customer'}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          <Input autoFocus aria-label="Search customers by name or mobile" placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-1" />
          <ul id={listId} role="listbox" aria-label="Customers" className="max-h-56 overflow-auto">
            {(data?.data ?? []).map((c) => (
              <li key={c.id} role="option" aria-selected={value === c.id}>
                <button
                  type="button"
                  onClick={() => { const l = `${c.name} · ${c.phone}`; setPicked({ id: c.id, label: l }); onChange(c.id, l); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary"
                >
                  <span>{c.name} <span className="text-muted-foreground">{c.phone}</span></span>
                  {value === c.id && <Check className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
            {data && data.data.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No customers</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
