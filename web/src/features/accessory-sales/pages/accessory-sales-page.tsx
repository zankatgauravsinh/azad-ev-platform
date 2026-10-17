import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { AccessorySaleStatus } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AccessorySalesTable } from '../components/accessory-sales-table';
import { AccessorySaleFormDialog } from '../components/accessory-sale-form-dialog';
import { AccessorySaleDetailDialog } from '../components/accessory-sale-detail-dialog';

const ALL = '__all__';

/** Accessory counter sales — each on its own invoice, separate from the scooter's. */
export function AccessorySalesPage(): JSX.Element {
  const canSell = useCan('accessories.sell');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<string>(ALL);
  const [selling, setSelling] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const filter = useMemo(() => ({ q: q || undefined, status: status === ALL ? undefined : (status as AccessorySaleStatus) }), [q, status]);

  const sellButton = canSell ? (
    <Button onClick={() => setSelling(true)}>
      <Plus className="h-4 w-4" /> Sell accessories
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Accessory Sales" description="Accessories sold on their own invoice — who bought what, and what is still due." actions={sellButton} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Invoice no., customer or mobile…" aria-label="Search accessory sales" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <AccessorySalesTable filter={filter} emptyAction={sellButton} />
      <AccessorySaleFormDialog open={selling} onOpenChange={setSelling} onDone={setCreated} />
      <AccessorySaleDetailDialog id={created} onOpenChange={(o) => !o && setCreated(null)} />
    </div>
  );
}
