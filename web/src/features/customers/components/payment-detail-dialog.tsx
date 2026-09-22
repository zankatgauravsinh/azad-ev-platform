import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { CustomerRelated } from '@azad/shared';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PaymentRow = CustomerRelated['payments'][number];

/**
 * Payment detail popup. There is no dedicated payment page/endpoint, so this reuses
 * the (enriched) related-payment record already loaded on the customer page and shows
 * it with its booking / invoice / service and customer context.
 */
export function PaymentDetailDialog({
  payment,
  customerName,
  onOpenChange,
}: {
  payment: PaymentRow | null;
  customerName: string;
  onOpenChange: (o: boolean) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const go = (to: string): void => { onOpenChange(false); navigate(to); };

  return (
    <Dialog open={Boolean(payment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        {!payment ? null : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatPaise(payment.amount)}</span>
                <span className="text-sm font-normal text-muted-foreground">{titleCase(payment.mode)}</span>
              </DialogTitle>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Receipt" value={payment.receiptNumber ?? '—'} mono />
              <Field label="Context" value={titleCase(payment.context)} />
              <Field label="Date" value={new Date(payment.paidAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />
              <Field label="Reference" value={payment.reference ?? '—'} />
              <Field label="Customer" value={customerName} />
              <Field label="Booking" value={payment.bookingCode ?? '—'} mono />
              <Field label="Invoice" value={payment.invoiceNumber ?? '—'} mono />
              <Field label="Service job" value={payment.serviceCode ?? '—'} mono />
            </dl>

            {(payment.bookingId || payment.serviceJobId) && (
              <div className="flex flex-wrap justify-end gap-2">
                {payment.bookingId && <Button size="sm" variant="outline" onClick={() => go(`/bookings/${payment.bookingId}`)}><ExternalLink className="h-4 w-4" /> Open booking</Button>}
                {payment.serviceJobId && <Button size="sm" variant="outline" onClick={() => go(`/service/${payment.serviceJobId}`)}><ExternalLink className="h-4 w-4" /> Open service job</Button>}
              </div>
            )}
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
