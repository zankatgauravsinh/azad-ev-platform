import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, MessageSquarePlus, Pencil, RefreshCw, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useCustomer, useCustomerActivity, useCustomerRelated, useDeleteCustomer } from '../hooks';
import { LeadStatusBadge } from '../components/lead-status-badge';
import { CustomerFormDialog } from '../components/customer-form-dialog';
import { ChangeStatusDialog } from '../components/change-status-dialog';
import { LogInteractionDialog } from '../components/log-interaction-dialog';
import { CustomerTimeline } from '../components/customer-timeline';
import { FollowUpsPanel } from '../components/follow-ups-panel';
import { NotesPanel } from '../components/notes-panel';
import { DocumentsPanel } from '../components/documents-panel';
import { PaymentDetailDialog } from '../components/payment-detail-dialog';
import { BookingDetailDialog } from '@/features/sales/components/booking-detail-dialog';
import { ServiceJobDetailDialog } from '@/features/service/components/service-job-detail-dialog';
import { DeliveryDetailDialog } from '@/features/delivery/components/delivery-detail-dialog';
import { WarrantyDetailDialog } from '@/features/warranty/components/warranty-detail-dialog';

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDelete = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const { data: customer, isLoading } = useCustomer(id);
  const del = useDeleteCustomer();
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading || !customer) {
    return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;
  }

  const confirmDelete = async (): Promise<void> => {
    try {
      await del.mutateAsync(customer.id);
      toast.success('Customer deleted');
      navigate('/customers');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not delete'));
    }
  };

  return (
    <div>
      <button type="button" onClick={() => navigate('/customers')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to customers
      </button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3"><User className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{customer.phone}</span>
              {customer.city && <><span>·</span><span>{customer.city}</span></>}
              <LeadStatusBadge status={customer.leadStatus} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setLogOpen(true)}><MessageSquarePlus className="h-4 w-4" /> Log</Button>
          <Button variant="outline" onClick={() => setStatusOpen(true)}><RefreshCw className="h-4 w-4" /> Status</Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
          {canDelete && <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" /> Delete</Button>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="warranty">Warranty</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 p-6 sm:grid-cols-3">
                <Info label="Mobile" value={customer.phone} />
                <Info label="Alternate" value={customer.altPhone ?? '—'} />
                <Info label="Email" value={customer.email ?? '—'} />
                <Info label="Address" value={customer.address ?? '—'} className="col-span-2 sm:col-span-3" />
                <Info label="City" value={customer.city ?? '—'} />
                <Info label="State" value={customer.state ?? '—'} />
                <Info label="PIN" value={customer.pin ?? '—'} />
                <Info label="Occupation" value={customer.occupation ?? '—'} />
                <Info label="Date of birth" value={customer.dateOfBirth ? new Date(customer.dateOfBirth).toLocaleDateString('en-IN') : '—'} />
                <Info label="Gender" value={customer.gender ? customer.gender[0] + customer.gender.slice(1).toLowerCase() : '—'} />
                <Info label="Lead source" value={customer.source ?? '—'} />
                <Info label="Assigned to" value={customer.assignedTo?.name ?? '—'} />
                <Info label="Preferred model" value={customer.preferredModel ? `${customer.preferredModel.brand} ${customer.preferredModel.name}` : '—'} />
                <Info label="Preferred colour" value={customer.preferredColour ?? '—'} />
                <Info label="Preferred finance" value={customer.preferredFinanceOption ?? '—'} />
                {customer.leadStatus === 'LOST' && customer.lostReason && (
                  <Info label="Lost reason" value={customer.lostReason} className="col-span-2 sm:col-span-3" />
                )}
              </CardContent>
            </Card>
            <Card><CardContent className="p-6"><FollowUpsPanel customerId={customer.id} /></CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline"><Card><CardContent className="p-6"><CustomerTimeline customerId={customer.id} /></CardContent></Card></TabsContent>
        <TabsContent value="documents"><Card><CardContent className="p-6"><DocumentsPanel customerId={customer.id} /></CardContent></Card></TabsContent>
        <TabsContent value="bookings"><RelatedList customerId={customer.id} customerName={customer.name} kind="bookings" /></TabsContent>
        <TabsContent value="payments"><RelatedList customerId={customer.id} customerName={customer.name} kind="payments" /></TabsContent>
        <TabsContent value="deliveries"><RelatedList customerId={customer.id} customerName={customer.name} kind="deliveries" /></TabsContent>
        <TabsContent value="service"><RelatedList customerId={customer.id} customerName={customer.name} kind="service" /></TabsContent>
        <TabsContent value="warranty"><RelatedList customerId={customer.id} customerName={customer.name} kind="warranty" /></TabsContent>
        <TabsContent value="notes"><Card><CardContent className="p-6"><NotesPanel customerId={customer.id} /></CardContent></Card></TabsContent>
        <TabsContent value="activity"><ActivityLog customerId={customer.id} /></TabsContent>
      </Tabs>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      <ChangeStatusDialog open={statusOpen} onOpenChange={setStatusOpen} customerId={customer.id} current={customer.leadStatus} />
      <LogInteractionDialog open={logOpen} onOpenChange={setLogOpen} customerId={customer.id} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={`Delete ${customer.name}?`} description="Soft-deleted; history retained." confirmLabel="Delete" destructive onConfirm={confirmDelete} />
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }): JSX.Element {
  return (
    <div className={className}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

type RelatedPayment = NonNullable<ReturnType<typeof useCustomerRelated>['data']>['payments'][number];

function RelatedList({ customerId, customerName, kind }: { customerId: string; customerName: string; kind: 'bookings' | 'payments' | 'deliveries' | 'service' | 'warranty' }): JSX.Element {
  const { data, isLoading } = useCustomerRelated(customerId);
  // One of these holds the record being viewed in a popup; the user stays on this page.
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewPayment, setViewPayment] = useState<RelatedPayment | null>(null);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const items = data?.[kind] ?? [];
  if (items.length === 0) {
    const labels = { bookings: 'bookings', payments: 'payments', deliveries: 'deliveries', service: 'service jobs', warranty: 'warranties' };
    return <EmptyState title={`No ${labels[kind]} yet`} description="This appears here as the customer moves through the journey." />;
  }
  return (
    <div className="space-y-2">
      {kind === 'bookings' && data!.bookings.map((b) => <Row key={b.id} left={`Booking ${b.code}`} sub={b.status} right={new Date(b.createdAt).toLocaleDateString('en-IN')} onView={() => setViewId(b.id)} />)}
      {kind === 'payments' && data!.payments.map((p) => <Row key={p.id} left={formatPaise(p.amount)} sub={`${p.context} · ${p.mode}`} right={new Date(p.paidAt).toLocaleDateString('en-IN')} onView={() => setViewPayment(p)} />)}
      {kind === 'deliveries' && data!.deliveries.map((d) => <Row key={d.id} left={`VIN ${d.vin}`} sub="Delivered" right={new Date(d.deliveredAt).toLocaleDateString('en-IN')} onView={d.bookingId ? () => setViewId(d.bookingId) : undefined} />)}
      {kind === 'service' && data!.service.map((s) => <Row key={s.id} left={s.code} sub={s.complaint} right={s.status} onView={() => setViewId(s.id)} />)}
      {kind === 'warranty' && data!.warranty.map((w) => (
        <Row key={w.unitId} left={`${w.model} ${w.variant} · ${w.vin}`} sub={w.warrantyExpiry ? `Expires ${new Date(w.warrantyExpiry).toLocaleDateString('en-IN')}` : 'No warranty data'} right={<Badge variant={w.active ? 'success' : 'muted'}>{w.active ? 'Active' : 'Expired'}</Badge>} onView={w.warrantyId ? () => setViewId(w.warrantyId) : undefined} />
      ))}

      {kind === 'bookings' && <BookingDetailDialog id={viewId} onOpenChange={(o) => !o && setViewId(null)} />}
      {kind === 'service' && <ServiceJobDetailDialog id={viewId} onOpenChange={(o) => !o && setViewId(null)} />}
      {kind === 'deliveries' && <DeliveryDetailDialog id={viewId} onOpenChange={(o) => !o && setViewId(null)} />}
      {kind === 'warranty' && <WarrantyDetailDialog id={viewId} onOpenChange={(o) => !o && setViewId(null)} />}
      {kind === 'payments' && <PaymentDetailDialog payment={viewPayment} customerName={customerName} onOpenChange={(o) => !o && setViewPayment(null)} />}
    </div>
  );
}

function Row({ left, sub, right, onView }: { left: string; sub: string; right: React.ReactNode; onView?: () => void }): JSX.Element {
  return (
    <Card><CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
      <div className="min-w-0"><p className="font-medium">{left}</p><p className="truncate text-muted-foreground">{sub}</p></div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground">{right}</span>
        {onView && <Button size="sm" variant="outline" onClick={onView}><Eye className="h-4 w-4" /> View</Button>}
      </div>
    </CardContent></Card>
  );
}

function ActivityLog({ customerId }: { customerId: string }): JSX.Element {
  const { data: entries = [], isLoading } = useCustomerActivity(customerId);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (entries.length === 0) return <EmptyState title="No activity" />;
  return (
    <Card><CardContent className="p-6">
      <ul className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
            <div><Badge variant="muted">{e.action}</Badge> <span className="ml-2">{e.summary}</span></div>
            <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  );
}
