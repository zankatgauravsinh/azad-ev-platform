import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBooking } from '../hooks';
import { BookingStatusBadge, PaymentStatusBadge } from './status-badges';

/**
 * Focused, read-only booking summary shown as a popup from another record's page
 * (e.g. the customer detail). Reuses useBooking and links to the full booking page.
 */
export function BookingDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const navigate = useNavigate();
  const { data: b, isLoading, isError, error } = useBooking(id ?? undefined);

  const openFull = (): void => {
    if (!id) return;
    onOpenChange(false);
    navigate(`/bookings/${id}`);
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        {isError ? (
          <p className="py-10 text-center text-sm text-destructive">{apiErrorMessage(error, 'Could not load booking')}</p>
        ) : isLoading || !b ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{b.code}</span>
                <BookingStatusBadge status={b.status} />
                <PaymentStatusBadge status={b.paymentSummary.status} />
              </DialogTitle>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Customer" value={b.customer.name} />
              <Field label="Vehicle" value={`${b.unit.variant.model.name} ${b.unit.variant.name}`} />
              <Field label="VIN" value={b.unit.vin} mono />
              <Field label="On-road total" value={formatPaise(b.total)} />
              <Field label="Paid" value={formatPaise(b.paymentSummary.paid)} />
              <Field label="Balance" value={formatPaise(b.paymentSummary.balance)} />
              <Field label="Invoice" value={b.sale?.invoiceNumber ?? '—'} mono />
            </dl>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openFull}><ExternalLink className="h-4 w-4" /> Open booking</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
