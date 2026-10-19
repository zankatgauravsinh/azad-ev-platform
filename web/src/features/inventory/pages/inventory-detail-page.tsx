import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bike, FileCheck2, IndianRupee, Pencil, RefreshCw, Trash2, User, Wrench } from 'lucide-react';
import { PayVendorDialog } from '@/features/vendors/components/pay-vendor-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useDeleteUnit, useUnit } from '../hooks';
import { UnitStatusBadge } from '../components/unit-status-badge';
import { UnitTimeline } from '../components/unit-timeline';
import { UnitMedia } from '../components/unit-media';
import { UnitFormDialog } from '../components/unit-form-dialog';
import { ChangeStatusDialog } from '../components/change-status-dialog';
import { IdentificationCorrectionDialog } from '../components/identification-correction-dialog';

export function InventoryDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const canUpdate = can('inventory.update');
  const canStatus = can('inventory.status');
  const canDelete = can('inventory.delete');
  const { data: unit, isLoading } = useUnit(id);
  const deleteUnit = useDeleteUnit();
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (isLoading || !unit) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // The server decides eligibility (unit.identity) and re-checks OWNER + inventory.update on submit.
  const canCorrect = canUpdate && user?.role === 'OWNER' && Boolean(unit.identity?.correctionEligible);

  const customer =
    unit.sales[0]?.customer ?? unit.bookings[0]?.customer ?? unit.serviceJobs[0]?.customer ?? null;

  const confirmDelete = async (): Promise<void> => {
    try {
      await deleteUnit.mutateAsync(unit.id);
      toast.success('Scooter deleted');
      navigate('/inventory');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not delete'));
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/inventory')}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inventory
      </button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3">
            <Bike className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {unit.variant.model.brand} {unit.variant.model.name} {unit.variant.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{unit.vin}</span>
              <span>·</span>
              <span>{unit.variant.colour}</span>
              <UnitStatusBadge status={unit.status} />
            </div>
          </div>
        </div>
        {(canStatus || canUpdate || canDelete) && (
          <div className="flex flex-wrap gap-2">
            {canStatus && (
              <Button variant="outline" onClick={() => setStatusOpen(true)}>
                <RefreshCw className="h-4 w-4" /> Change status
              </Button>
            )}
            {canUpdate && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {canCorrect && (
              <Button variant="outline" onClick={() => setCorrectOpen(true)}>
                <FileCheck2 className="h-4 w-4" /> Correct identification
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Information</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="history">Bookings &amp; Sales</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="media">Documents &amp; Photos</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 p-6 sm:grid-cols-3">
                <Info label="VIN" value={unit.vin} mono />
                <Info label="Motor number" value={unit.motorNumber} mono />
                <Info label="Battery number" value={unit.batteryNumber} mono />
                <Info label="Controller number" value={unit.controllerNumber ?? '—'} mono={Boolean(unit.controllerNumber)} />
                <Info label="Charger number" value={unit.chargerNumber ?? '—'} mono={Boolean(unit.chargerNumber)} />
                <Info label="Model" value={`${unit.variant.model.brand} ${unit.variant.model.name}`} />
                <Info label="Variant" value={unit.variant.name} />
                <Info label="Colour" value={unit.variant.colour} />
                <Info label="Purchase date" value={unit.purchaseDate ? new Date(unit.purchaseDate).toLocaleDateString('en-IN') : '—'} />
                {/* The API sends purchase figures only to users with inventory.cost (the owner, by default). */}
                {unit.purchaseCost !== undefined && (
                  <>
                    <Info label="Purchase price" value={formatPaise(unit.purchasePrice ?? 0)} />
                    <Info label={unit.purchaseGstRateBp != null ? `GST paid (${unit.purchaseGstRateBp / 100}%)` : 'GST paid'} value={formatPaise(unit.purchaseGst ?? 0)} />
                    <Info label="Transport charge" value={formatPaise(unit.transportCharge ?? 0)} />
                    <Info label="Purchase cost" value={formatPaise(unit.purchaseCost)} />
                  </>
                )}
                <Info
                  className="col-span-2 sm:col-span-3"
                  label={unit.warrantyIssued ? 'Warranty (months) — card issued' : 'Warranty (months)'}
                  value={warrantyMonthsText(unit)}
                />
                <Info label="Selling price" value={formatPaise(unit.sellingPrice)} />
                <Info
                  label="Bought from"
                  value={unit.vendor && can('vendors.view') ? <Link to={`/vendors/${unit.vendor.id}`} className="hover:underline">{unit.vendor.name}</Link> : (unit.vendor?.name ?? unit.supplier ?? '—')}
                />
                {unit.vendorBillNumber && <Info label="Vendor bill no." value={unit.vendorBillNumber} mono />}
                {unit.purchaseCost !== undefined && (
                  <Info
                    label="Paid to vendor"
                    value={
                      unit.costInExpenses ? (
                        <Badge variant="muted" title="Bought before per-scooter tracking — its cost was recorded as a Vehicle Purchase expense">Expensed earlier</Badge>
                      ) : unit.purchasePaid ? (
                        <Badge variant="success">Paid{unit.purchasePaidAt ? ` · ${new Date(unit.purchasePaidAt).toLocaleDateString('en-IN')}` : ''}</Badge>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant="warning">Not paid</Badge>
                          {unit.vendor && can('vendors.manage') && Number(unit.purchaseCost) > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}><IndianRupee className="h-3.5 w-3.5" /> Pay vendor</Button>
                          )}
                        </span>
                      )
                    }
                  />
                )}
                <Info label="Location" value={unit.location ?? '—'} />
                <Info label="Added" value={new Date(unit.createdAt).toLocaleDateString('en-IN')} />
                {unit.notes && <Info className="col-span-2 sm:col-span-3" label="Notes" value={unit.notes} />}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <User className="h-4 w-4" /> Customer
                </p>
                {customer ? (
                  <div className="text-sm">
                    <p className="font-medium">{customer.name}</p>
                    <p className="text-muted-foreground">{customer.phone}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No customer linked yet. A customer appears once this unit is booked or sold.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="p-6">
              <UnitTimeline events={unit.events} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          {unit.bookings.length === 0 && unit.sales.length === 0 ? (
            <EmptyState title="No bookings or sales yet" description="This unit has not been booked or sold." />
          ) : (
            <div className="space-y-3">
              {unit.sales.map((sale) => (
                <Card key={sale.id}>
                  <CardContent className="flex items-center justify-between p-4 text-sm">
                    <div>
                      <p className="font-medium">Sale {sale.invoiceNumber ?? '(draft)'}</p>
                      <p className="text-muted-foreground">{sale.customer.name} · {sale.status}</p>
                    </div>
                    <span className="tabular-nums">{formatPaise(sale.total)}</span>
                  </CardContent>
                </Card>
              ))}
              {unit.bookings.map((booking) => (
                <Card key={booking.id}>
                  <CardContent className="flex items-center justify-between p-4 text-sm">
                    <div>
                      <p className="font-medium">Booking {booking.code}</p>
                      <p className="text-muted-foreground">{booking.customer.name} · {booking.status}</p>
                    </div>
                    <span className="text-muted-foreground">
                      {new Date(booking.createdAt).toLocaleDateString('en-IN')}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="service">
          {unit.serviceJobs.length === 0 ? (
            <EmptyState icon={Wrench} title="No service history" description="Service jobs for this unit will show here." />
          ) : (
            <div className="space-y-3">
              {unit.serviceJobs.map((job) => (
                <Card key={job.id}>
                  <CardContent className="flex items-center justify-between p-4 text-sm">
                    <div>
                      <p className="font-medium">{job.code}</p>
                      <p className="text-muted-foreground">{job.complaint}</p>
                    </div>
                    <span className="text-muted-foreground">{job.status}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="media">
          <Card>
            <CardContent className="p-6">
              <UnitMedia unitId={unit.id} photos={unit.photos} documents={unit.documents} canEdit={canUpdate} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <UnitFormDialog open={editOpen} onOpenChange={setEditOpen} unit={unit} />
      {canCorrect && <IdentificationCorrectionDialog open={correctOpen} onOpenChange={setCorrectOpen} unit={unit} />}
      <ChangeStatusDialog open={statusOpen} onOpenChange={setStatusOpen} unitId={unit.id} current={unit.status} />
      {unit.vendor && (
        <PayVendorDialog open={payOpen} onOpenChange={setPayOpen} vendorId={unit.vendor.id} vendorName={unit.vendor.name} preselect={[{ kind: 'SCOOTER', id: unit.id }]} />
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${unit.vin}?`}
        description="The scooter is soft-deleted and its history is retained."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function Info({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

/** "Motor 36 · Battery 60 · Controller 12 · Charger —" ("default" when not entered, "not covered" for 0). */
function warrantyMonthsText(unit: { motorWarrantyMonths: number | null; batteryWarrantyMonths: number | null; controllerWarrantyMonths: number | null; chargerWarrantyMonths: number | null; warrantyExtras?: { name: string; months: number }[] }): string {
  const one = (label: string, months: number | null): string => `${label} ${months == null ? 'default' : months === 0 ? 'not covered' : months}`;
  return [
    one('Motor', unit.motorWarrantyMonths),
    one('Battery', unit.batteryWarrantyMonths),
    one('Controller', unit.controllerWarrantyMonths),
    one('Charger', unit.chargerWarrantyMonths),
    ...(unit.warrantyExtras ?? []).map((e) => `${e.name} ${e.months}`),
  ].join(' · ');
}
