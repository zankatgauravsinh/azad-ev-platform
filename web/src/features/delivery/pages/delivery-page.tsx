import { useMemo, useState } from 'react';
import { Download, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { ExportFormat } from '@azad/shared';
import { DELIVERY_STATUSES, type DeliveryListRow, type DeliveryStatus } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { useDebounce } from '@/hooks/use-debounce';
import { reportsApi } from '@/features/reports/api';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDeliveries, useDeliveryDashboard } from '../hooks';
import { deliveryStatusLabel, deliveryStatusTone } from '../meta';
import { DeliveryDetailDialog } from '../components/delivery-detail-dialog';

const iso = (d: string | null): string => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

export function DeliveryPage(): JSX.Element {
  const { data: dash } = useDeliveryDashboard();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useDeliveries(query);

  const exportReport = async (format: ExportFormat): Promise<void> => {
    try { saveBlob(await reportsApi.exportReport('deliveries', format), `deliveries-report.${format === 'excel' ? 'xlsx' : format}`); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const columns: Column<DeliveryListRow>[] = [
    { key: 'code', header: 'Booking', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customerName}</p><p className="text-xs text-muted-foreground">{r.customerPhone}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => <div><p>{r.model} {r.variant}</p><p className="font-mono text-xs text-muted-foreground">{r.vin}</p></div> },
    { key: 'expected', header: 'Expected', render: (r) => r.status === 'DELIVERED' ? `Delivered ${iso(r.actualDelivery)}` : iso(r.expectedDelivery) },
    { key: 'balance', header: 'Balance', render: (r) => Number(r.balance) > 0 ? <span className="font-medium text-destructive">{formatPaise(r.balance)}</span> : '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={deliveryStatusTone[r.status]}>{deliveryStatusLabel[r.status]}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Delivery" description="Schedule handovers, run the pre-delivery checklist and hand over vehicles." actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline"><Download className="h-4 w-4" /> Export</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportReport('pdf')}>PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportReport('excel')}>Excel</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportReport('csv')}>CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      } />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ready to deliver" value={dash?.readyToDeliver ?? '—'} tone="positive" />
        <StatCard label="Scheduled" value={dash?.scheduledToday ?? '—'} hint={`${dash?.overdue ?? 0} overdue`} tone={dash?.overdue ? 'warning' : 'default'} />
        <StatCard label="Awaiting payment" value={dash?.awaitingPayment ?? '—'} tone={dash?.awaitingPayment ? 'danger' : 'default'} />
        <StatCard label="Delivered this month" value={dash?.deliveredThisMonth ?? '—'} hint={`${dash?.pendingDocuments ?? 0} pending docs`} />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search booking, customer, VIN, invoice…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as DeliveryStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All stages</SelectItem>{DELIVERY_STATUSES.map((s) => <SelectItem key={s} value={s}>{deliveryStatusLabel[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.bookingId} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => setOpenId(r.bookingId)}
        emptyState={<EmptyState icon={Truck} title="No deliveries" description="Confirmed bookings appear here, ready to schedule and hand over." />} />

      <DeliveryDetailDialog id={openId} onOpenChange={(o) => { if (!o) setOpenId(null); }} />
    </div>
  );
}
