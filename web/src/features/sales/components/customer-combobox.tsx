import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { customersApi } from '@/features/customers/api';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

export function CustomerCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string, label: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const { data } = useQuery({
    queryKey: ['customers', 'combobox', q],
    queryFn: () => customersApi.list({ q: q || undefined, pageSize: 8 }),
    enabled: open,
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm"
      >
        <span className={cn(!value && 'text-muted-foreground')}>{value ? 'Customer selected' : 'Select customer'}</span>
        <ChevronsUpDown className="h-4 w-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          <Input autoFocus placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-1" />
          <ul className="max-h-56 overflow-auto">
            {(data?.data ?? []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { onChange(c.id, `${c.name} · ${c.phone}`); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary"
                >
                  <span>{c.name} <span className="text-muted-foreground">{c.phone}</span></span>
                  {value === c.id && <Check className="h-4 w-4" />}
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
