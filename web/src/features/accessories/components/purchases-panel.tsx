import { useMemo, useState } from 'react';
import { PackagePlus, Search, Truck } from 'lucide-react';
import type { AccessoryPurchaseDto } from '@azad/shared';
import { formatPaiseExact } from '@/lib/money';
import { useDebounce } from '@/hooks/use-debounce';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccessoryPurchases } from '../purchases-hooks';
import { PurchaseFormDialog } from './purchase-form-dialog';
import { PurchaseDetailDialog, PurchaseStatusBadge } from './purchase-detail-dialog';

const ALL = '__all__';

/** Purchases from vendors (owner): bills with their status; new purchase; a row opens the bill. */
export function PurchasesPanel(): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [filter, setFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const params = useMemo(
    () => ({ q: q || undefined, page, pageSize: 20, ...(filter === 'UNPAID' ? { status: 'ACTIVE' as const, paid: false } : filter === 'PAID' ? { status: 'ACTIVE' as const, paid: true } : filter === 'CANCELLED' ? { status: 'CANCELLED' as const } : {}) }),
    [q, page, filter],
  );
  const { data, isLoading, isFetching } = useAccessoryPurchases(params);

  const columns: Column<AccessoryPurchaseDto>[] = [
    { key: 'number', header: 'Purchase', render: (p) => <div><p className="font-mono text-sm">{p.purchaseNumber}</p><p className="text-xs text-muted-foreground">{new Date(p.purchaseDate).toLocaleDateString('en-IN', { timeZone: 'UTC' })}</p></div> },
    { key: 'vendor', header: 'Vendor', render: (p) => <div><p className="font-medium">{p.vendorName ?? '—'}</p>{p.vendorInvoiceNumber && <p className="text-xs text-muted-foreground">Bill {p.vendorInvoiceNumber}</p>}</div> },
    { key: 'items', header: 'Accessories', render: (p) => <span className="line-clamp-2 text-sm">{p.itemsSummary}</span> },
    { key: 'total', header: 'Bill total', align: 'right', render: (p) => <span className="tabular-nums">{formatPaiseExact(p.total)}</span> },
    { key: 'status', header: 'Status', render: (p) => <PurchaseStatusBadge p={p} /> },
  ];
  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <PackagePlus className="h-4 w-4" /> New purchase
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Purchase no., bill no. or vendor…" aria-label="Search purchases" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36" aria-label="Purchase status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="UNPAID">Unpaid</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">{addButton}</div>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(p) => p.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(p) => setOpenId(p.id)}
        emptyState={<EmptyState icon={Truck} title="No purchases yet" description="Record the accessories you buy from vendors to add them to stock." action={addButton} />}
      />
      <PurchaseFormDialog open={adding} onOpenChange={setAdding} onDone={setOpenId} />
      <PurchaseDetailDialog id={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}
