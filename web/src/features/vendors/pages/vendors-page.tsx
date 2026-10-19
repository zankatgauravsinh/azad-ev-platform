import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Star, Truck } from 'lucide-react';
import { VENDOR_TYPES, VENDOR_TYPE_LABEL, type VendorDto, type VendorStatus, type VendorType } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { useVendors } from '@/features/finance/hooks';
import { vendorStatusTone } from '@/features/finance/meta';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VendorFormDialog } from '../components/vendor-form-dialog';

const ALL = '__all__';

/** Everyone the showroom buys from, with what was bought and what is still owed. A row opens the vendor's page. */
export function VendorsPage(): JSX.Element {
  const navigate = useNavigate();
  const canManage = useCan('vendors.manage');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [type, setType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const query = useMemo(
    () => ({ page, pageSize: 20, q: q || undefined, type: type === ALL ? undefined : (type as VendorType), status: status === ALL ? undefined : (status as VendorStatus) }),
    [page, q, type, status],
  );
  const { data, isLoading, isFetching } = useVendors(query);

  const columns: Column<VendorDto>[] = [
    { key: 'vendorNumber', header: 'Number', render: (v) => <span className="font-mono text-xs">{v.vendorNumber}</span> },
    {
      key: 'name',
      header: 'Vendor',
      render: (v) => (
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {v.name}
            {v.isDefaultScooterVendor && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Default for new scooters" />}
          </p>
          <p className="text-xs text-muted-foreground">{[v.contactPerson, v.mobile].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (v) => VENDOR_TYPE_LABEL[v.type] },
    { key: 'gst', header: 'GSTIN', render: (v) => <span className="font-mono text-xs">{v.gstNumber ?? '—'}</span> },
    { key: 'scooters', header: 'Scooters', align: 'right', render: (v) => <span className="tabular-nums">{v.scooterCount || '—'}</span> },
    { key: 'purchases', header: 'Purchases', align: 'right', render: (v) => <span className="tabular-nums">{formatPaise(v.totalPurchases)}</span> },
    {
      key: 'outstanding',
      header: 'Owed',
      align: 'right',
      render: (v) => (
        <div className="text-right">
          <p className={Number(v.outstanding) > 0 ? 'font-medium tabular-nums text-amber-600' : 'tabular-nums'}>{formatPaise(v.outstanding)}</p>
          {Number(v.overdue) > 0 && <p className="text-xs tabular-nums text-destructive">{formatPaise(v.overdue)} overdue</p>}
          {Number(v.advance) > 0 && <p className="text-xs tabular-nums text-emerald-600">{formatPaise(v.advance)} advance</p>}
        </div>
      ),
    },
    { key: 'credit', header: 'Credit', align: 'right', render: (v) => (v.creditDays ? `${v.creditDays} days` : '—') },
    { key: 'status', header: 'Status', render: (v) => <Badge variant={vendorStatusTone[v.status]}>{titleCase(v.status)}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Everyone you buy from — scooters, accessories, parts and services. Click a vendor for everything you have bought and paid."
        actions={canManage ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New vendor</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search name, number, GSTIN, contact…" aria-label="Search vendors" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
          <SelectTrigger className="w-44" aria-label="Type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {VENDOR_TYPES.map((t) => <SelectItem key={t} value={t}>{VENDOR_TYPE_LABEL[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-32" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value={ALL}>All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(v) => v.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(v) => navigate(`/vendors/${v.id}`)}
        emptyState={<EmptyState icon={Truck} title="No vendors" description={canManage ? 'Add the companies you buy scooters, accessories and services from.' : 'No vendor matches.'} />}
      />
      {data?.data[0]?.costHidden && (
        <p className="mt-3 text-xs text-muted-foreground">Purchases and amounts owed leave out scooter and accessory purchase bills — what was paid for stock is visible to the owner only.</p>
      )}

      <VendorFormDialog open={adding} onOpenChange={setAdding} onSaved={(v) => navigate(`/vendors/${v.id}`)} />
    </div>
  );
}
