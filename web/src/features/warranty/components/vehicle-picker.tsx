import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/use-debounce';
import { inventoryApi } from '@/features/inventory/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Search inventory units by VIN / motor / battery and pick one. */
export function VehiclePicker({
  search,
  onSearch,
  value,
  onPick,
}: {
  search: string;
  onSearch: (v: string) => void;
  value: string;
  onPick: (unitId: string, label: string) => void;
}): JSX.Element {
  const q = useDebounce(search);
  const { data } = useQuery({ queryKey: ['warranty', 'unit-search', q], queryFn: () => inventoryApi.list({ q: q || undefined, pageSize: 6 }), enabled: q.length > 1 });
  return (
    <div className="space-y-1">
      <Label>Vehicle (VIN / motor / battery)</Label>
      <Input placeholder="Search VIN…" value={search} onChange={(e) => onSearch(e.target.value)} />
      {q.length > 1 && (data?.data.length ?? 0) > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border">
          {data?.data.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u.id, `${u.variant.model.name} ${u.variant.name} · ${u.vin}`)}
              className={cn('flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted', value === u.id && 'bg-muted')}
            >
              <span>{u.variant.model.name} {u.variant.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{u.vin}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
