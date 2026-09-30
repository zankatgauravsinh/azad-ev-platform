import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageX, Plus, Search } from 'lucide-react';
import { RETURN_STATUSES, type ReturnStatus, type VehicleReturnDto } from '@azad/shared';
import { formatPaise } from '@/lib/money';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useReturns } from '../hooks';
import { returnStatusLabel, returnStatusTone } from '../meta';
import { ReturnDetailDialog } from '../components/return-detail-dialog';
import { CreateReturnDialog } from '../components/create-return-dialog';

const iso = (d: string | null): string => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

export function ReturnsListPage(): JSX.Element {
  const { user } = useAuth();
  const canRequest = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'SALES_EXECUTIVE';
  const [params] = useSearchParams();
  const customerId = params.get('customerId') ?? undefined;

  const [status, setStatus] = useState<ReturnStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const query = useMemo(() => ({ page, pageSize: 20, status: status === 'ALL' ? undefined : status, customerId }), [page, status, customerId]);
  const { data, isLoading, isFetching } = useReturns(query);

  // The list API filters by status/customer server-side; this box quick-filters the loaded page.
  const rows = useMemo(() => {
    const all = data?.data ?? [];
    if (!filter.trim()) return all;
    const f = filter.toLowerCase();
    return all.filter((r) => r.returnNumber.toLowerCase().includes(f) || r.customerName.toLowerCase().includes(f) || r.vin.toLowerCase().includes(f));
  }, [data, filter]);

  const columns: Column<VehicleReturnDto>[] = [
    { key: 'returnNumber', header: 'Return', render: (r) => <span className="font-mono text-xs">{r.returnNumber}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customerName}</p><p className="font-mono text-xs text-muted-foreground">{r.vin}</p></div> },
    { key: 'booking', header: 'Booking', render: (r) => <span className="font-mono text-xs">{r.bookingCode}</span> },
    { key: 'requested', header: 'Requested', render: (r) => iso(r.requestedAt) },
    { key: 'saleTotal', header: 'Sale total', render: (r) => formatPaise(r.saleTotal) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={returnStatusTone[r.status]}>{returnStatusLabel[r.status]}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Vehicle Returns" description="Post-delivery sales returns — request, inspect, approve and complete."
        actions={canRequest ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Request return</Button> : undefined} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Filter this page by return no., customer or VIN…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as ReturnStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{RETURN_STATUSES.map((s) => <SelectItem key={s} value={s}>{returnStatusLabel[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => setOpenId(r.id)}
        emptyState={<EmptyState icon={PackageX} title="No returns" description="Post-delivery return requests appear here." />} />

      <ReturnDetailDialog id={openId} onOpenChange={(o) => { if (!o) setOpenId(null); }} />
      <CreateReturnDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}
