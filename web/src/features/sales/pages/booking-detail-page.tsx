import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Banknote, CalendarClock, CheckCircle2, Download, Eye, FileText, Printer, Shield, Truck, Undo2, User } from 'lucide-react';
import { toast } from 'sonner';
import { BookingStatus, PaymentStatus } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { openBlob, printBlob, saveBlob } from '@/lib/download';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { useBooking, useSalesInvalidate } from '../hooks';
import { salesApi } from '../api';
import { BookingStatusBadge, FinanceStatusBadge, InsuranceStatusBadge, PaymentStatusBadge } from '../components/status-badges';
import { FinanceDialog, InsuranceDialog, PaymentDialog, ScheduleDeliveryDialog } from '../components/booking-dialogs';
import { CustomerDetailDialog } from '@/features/customers/components/customer-detail-dialog';
import { CreateReturnDialog } from '@/features/returns/components/create-return-dialog';
import { ReturnDetailDialog } from '@/features/returns/components/return-detail-dialog';

export function BookingDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useSalesInvalidate();
  const { data: b, isLoading } = useBooking(id);
  const [dialog, setDialog] = useState<'payment' | 'finance' | 'insurance' | 'schedule' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [viewCustomer, setViewCustomer] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [viewReturnId, setViewReturnId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !b) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  const active = b.status !== BookingStatus.CANCELLED;
  const paid = b.paymentSummary.status === PaymentStatus.PAID;

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    try { await fn(); invalidate(); toast.success(ok); }
    catch (e) { toast.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };

  // Invoice actions read the already-generated invoice — repeatable, never regenerates.
  const invoiceFile = (): string => `${(b.sale?.invoiceNumber ?? 'invoice').replace(/\//g, '-')}.pdf`;
  const withInvoicePdf = async (consume: (blob: Blob) => void): Promise<void> => {
    try { consume(await salesApi.invoicePdf(b.id)); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };
  const viewInvoice = (): Promise<void> => withInvoicePdf((blob) => openBlob(blob, invoiceFile()));
  const downloadInvoice = (): Promise<void> => withInvoicePdf((blob) => saveBlob(blob, invoiceFile()));
  const printInvoice = (): Promise<void> => withInvoicePdf((blob) => printBlob(blob, invoiceFile()));

  const rows: { label: string; value: string; negative?: boolean }[] = [
    { label: 'Ex-showroom', value: formatPaise(b.exShowroom) },
    { label: 'Discount', value: formatPaise(b.discount), negative: true },
    { label: 'Exchange', value: formatPaise(b.exchangeValue), negative: true },
    { label: 'Accessories', value: formatPaise(b.accessoriesTotal) },
    { label: 'RTO', value: formatPaise(b.rto) },
    { label: 'Insurance', value: formatPaise(b.insuranceCharge) },
    { label: 'Registration', value: formatPaise(b.registration) },
    { label: 'Extended warranty', value: formatPaise(b.extendedWarranty) },
  ];

  return (
    <div>
      <button type="button" onClick={() => navigate('/bookings')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to bookings</button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{b.code}</h1>
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentSummary.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {b.unit.variant.model.name} {b.unit.variant.name} · {b.unit.variant.colour} · <span className="font-mono">{b.unit.vin}</span>
          </p>
        </div>
        {active && (
          <div className="flex flex-wrap gap-2">
            {!paid && <Button onClick={() => setDialog('payment')}><Banknote className="h-4 w-4" /> Take payment</Button>}
            <Button variant="outline" onClick={() => setDialog('finance')}><Banknote className="h-4 w-4" /> Finance</Button>
            <Button variant="outline" onClick={() => setDialog('insurance')}><Shield className="h-4 w-4" /> Insurance</Button>
            <Button variant="outline" onClick={() => setDialog('schedule')}><CalendarClock className="h-4 w-4" /> Schedule</Button>
            {!b.sale ? (
              <Button variant="outline" onClick={() => run(() => salesApi.generateInvoice(b.id), 'Invoice generated')} disabled={busy}><FileText className="h-4 w-4" /> Generate invoice</Button>
            ) : (
              <>
                <Button variant="outline" onClick={viewInvoice}><Eye className="h-4 w-4" /> View invoice</Button>
                <Button variant="outline" onClick={downloadInvoice}><Download className="h-4 w-4" /> Download PDF</Button>
                <Button variant="outline" onClick={printInvoice}><Printer className="h-4 w-4" /> Print</Button>
              </>
            )}
            {b.sale && !b.actualDelivery && <Button variant="accent" onClick={() => run(() => salesApi.deliver(b.id), 'Delivered')} disabled={busy}><Truck className="h-4 w-4" /> Deliver</Button>}
            {b.sale && b.actualDelivery && <Button variant="outline" onClick={() => setReturnOpen(true)}><Undo2 className="h-4 w-4" /> Request return</Button>}
            {b.status !== BookingStatus.CONVERTED && <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4" /> Cancel</Button>}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Price breakup */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <h3 className="mb-3 text-sm font-semibold">Price breakup</h3>
            <div className="space-y-1.5 text-sm">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums">{r.negative ? '− ' : ''}{r.value}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
                <span>On-road total</span><span className="tabular-nums">{formatPaise(b.total)}</span>
              </div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Paid</span><span className="tabular-nums text-emerald-600">{formatPaise(b.paymentSummary.paid)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Balance</span><span className="tabular-nums text-destructive">{formatPaise(b.paymentSummary.balance)}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Customer + delivery */}
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" /> Customer</p>
              <p className="text-sm">{b.customer.name}</p>
              <p className="text-sm text-muted-foreground">{b.customer.phone}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setViewCustomer(true)}><Eye className="h-4 w-4" /> View customer</Button>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Delivery</p>
              <p className="text-sm">Expected: {b.expectedDelivery ? new Date(b.expectedDelivery).toLocaleDateString('en-IN') : '—'}</p>
              <p className="text-sm">Actual: {b.actualDelivery ? new Date(b.actualDelivery).toLocaleDateString('en-IN') : '—'}</p>
              {b.pendingDocuments && <p className="text-sm text-amber-600">Pending: {b.pendingDocuments}</p>}
            </div>
            {b.sale && (
              <div>
                <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4" /> Invoice</p>
                <p className="text-sm font-mono">{b.sale.invoiceNumber}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={viewInvoice}><Eye className="h-4 w-4" /> View</Button>
                  <Button size="sm" variant="outline" onClick={downloadInvoice}><Download className="h-4 w-4" /> PDF</Button>
                  <Button size="sm" variant="outline" onClick={printInvoice}><Printer className="h-4 w-4" /> Print</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payments */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <h3 className="mb-3 text-sm font-semibold">Payments</h3>
            {b.payments.length === 0 ? <EmptyState icon={Banknote} title="No payments yet" /> : (
              <ul className="divide-y text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <div><span className="font-mono text-xs text-muted-foreground">{p.receiptNumber}</span> · {titleCase(p.mode)}{p.reference ? ` · ${p.reference}` : ''}</div>
                    <div className="flex items-center gap-3"><span className="tabular-nums">{formatPaise(p.amount)}</span><span className="text-xs text-muted-foreground">{new Date(p.paidAt).toLocaleDateString('en-IN')}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Finance + insurance */}
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4" /> Finance</p>
              {b.finance ? (
                <div className="text-sm"><p>{b.finance.financeCompany} <FinanceStatusBadge status={b.finance.status} /></p><p className="text-muted-foreground">Loan {formatPaise(b.finance.loanAmount)} · EMI {formatPaise(b.finance.emiAmount)} × {b.finance.tenureMonths}mo</p></div>
              ) : <p className="text-sm text-muted-foreground">Not added</p>}
            </div>
            <div>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Shield className="h-4 w-4" /> Insurance</p>
              {b.insurance ? (
                <div className="text-sm"><p>{b.insurance.provider} <InsuranceStatusBadge status={b.insurance.status} /></p><p className="text-muted-foreground">Premium {formatPaise(b.insurance.premium)}{b.insurance.policyNumber ? ` · ${b.insurance.policyNumber}` : ''}</p></div>
              ) : <p className="text-sm text-muted-foreground">Not added</p>}
            </div>
            {b.actualDelivery && <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Delivered {new Date(b.actualDelivery).toLocaleDateString('en-IN')}</p>}
          </CardContent>
        </Card>
      </div>

      {dialog === 'payment' && <PaymentDialog open onOpenChange={() => setDialog(null)} booking={b} />}
      {dialog === 'finance' && <FinanceDialog open onOpenChange={() => setDialog(null)} booking={b} />}
      {dialog === 'insurance' && <InsuranceDialog open onOpenChange={() => setDialog(null)} booking={b} />}
      {dialog === 'schedule' && <ScheduleDeliveryDialog open onOpenChange={() => setDialog(null)} booking={b} />}
      <CustomerDetailDialog id={viewCustomer ? b.customer.id : null} onOpenChange={setViewCustomer} />
      {b.sale && (
        <CreateReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          preset={{ saleId: b.sale.id, bookingCode: b.code, customerName: b.customer.name }}
          onCreated={(rid) => setViewReturnId(rid)}
        />
      )}
      <ReturnDetailDialog id={viewReturnId} onOpenChange={(o) => { if (!o) setViewReturnId(null); }} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={`Cancel booking ${b.code}?`} description="The reserved scooter is released back to Available." confirmLabel="Cancel booking" destructive onConfirm={() => run(() => salesApi.cancelBooking(b.id, 'Cancelled by staff'), 'Booking cancelled')} />
    </div>
  );
}
