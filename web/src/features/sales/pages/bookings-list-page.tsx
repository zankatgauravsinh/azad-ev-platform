import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, ClipboardList, Plus, Search } from 'lucide-react';
import { BOOKING_STATUSES, BookingStatus, type ListBookingsQuery } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
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
import { type BookingDto, type VehicleUnitDetail } from '../api';
import { BookingStatusBadge, DeliveryStatusBadge } from '../components/status-badges';
import { BookingFormDialog } from '../components/booking-form-dialog';
import { VehicleDetailsDialog } from '../components/vehicle-details-dialog';

export function BookingsListPage(): JSX.Element {
  const navigate = useNavigate();
  const canCreate = useCan('bookings.create');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<BookingStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [vehicleUnit, setVehicleUnit] = useState<VehicleUnitDetail | null>(null);

  const query: Partial<ListBookingsQuery> = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useBookings(query);

  const columns: Column<BookingDto>[] = [
    { key: 'code', header: 'Booking', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-muted-foreground">{r.customer.phone}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => <div><p>{r.unit.variant.model.name} {r.unit.variant.name}</p><p className="font-mono text-xs text-muted-foreground">{r.unit.vin}</p></div> },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="tabular-nums">{formatPaise(r.total)}</span> },
    { key: 'paid', header: 'Paid', align: 'right', render: (r) => <span className="tabular-nums text-emerald-600">{formatPaise(r.paymentSummary.paid)}</span> },
    // A cancelled booking's pre-cancellation shortfall is not an active receivable — show no Pending amount.
    { key: 'pending', header: 'Pending', align: 'right', render: (r) => (r.status === BookingStatus.CANCELLED ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums text-destructive">{formatPaise(r.paymentSummary.balance)}</span>) },
    { key: 'status', header: 'Status', render: (r) => <div className="flex flex-wrap items-center gap-1"><BookingStatusBadge status={r.status} /><DeliveryStatusBadge hasSale={Boolean(r.sale)} delivered={Boolean(r.actualDelivery)} /></div> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label="View vehicle details"
          onClick={(e) => { e.stopPropagation(); setVehicleUnit(r.unit); }}
        >
          <Bike className="h-4 w-4" /> Vehicle
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Bookings" description="Confirmed orders through to delivery." actions={canCreate ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New booking</Button> : undefined} />
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
        emptyState={<EmptyState icon={ClipboardList} title="No bookings" description="Create a booking to allocate a scooter." action={canCreate ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New booking</Button> : undefined} />} />
      <BookingFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <VehicleDetailsDialog open={Boolean(vehicleUnit)} onOpenChange={(o) => { if (!o) setVehicleUnit(null); }} unit={vehicleUnit} />
    </div>
  );
}
