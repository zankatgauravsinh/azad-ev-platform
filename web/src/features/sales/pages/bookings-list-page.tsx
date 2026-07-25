import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { BOOKING_STATUSES, BookingStatus, type ListBookingsQuery } from '@azad/shared';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBookings } from '../hooks';
import { type BookingDto } from '../api';
import { BookingStatusBadge, PaymentStatusBadge } from '../components/status-badges';
import { BookingFormDialog } from '../components/booking-form-dialog';

export function BookingsListPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<BookingStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const query: Partial<ListBookingsQuery> = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useBookings(query);

  const columns: Column<BookingDto>[] = [
    { key: 'code', header: 'Booking', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-muted-foreground">{r.customer.phone}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => <div><p>{r.unit.variant.model.name} {r.unit.variant.name}</p><p className="font-mono text-xs text-muted-foreground">{r.unit.vin}</p></div> },
    { key: 'total', header: 'On-road', align: 'right', render: (r) => <span className="tabular-nums">{formatPaise(r.total)}</span> },
    { key: 'payment', header: 'Payment', render: (r) => <PaymentStatusBadge status={r.paymentSummary.status} /> },
    { key: 'status', header: 'Status', render: (r) => <BookingStatusBadge status={r.status} /> },
    { key: 'expected', header: 'Expected', render: (r) => (r.expectedDelivery ? new Date(r.expectedDelivery).toLocaleDateString('en-IN') : '—') },
  ];

  return (
    <div>
      <PageHeader title="Bookings" description="Confirmed orders through to delivery." actions={<Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New booking</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search booking, customer or VIN…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as BookingStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{BOOKING_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => navigate(`/bookings/${r.id}`)}
        emptyState={<EmptyState icon={ClipboardList} title="No bookings" description="Create a booking to allocate a scooter." action={<Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New booking</Button>} />} />
      <BookingFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
