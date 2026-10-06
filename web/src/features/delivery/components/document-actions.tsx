import { Download, Eye, FileDown, Printer } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { openBlob, printBlob, saveBlob } from '@/lib/download';
import { useDocumentDownload, type DocumentConsumer } from '@/hooks/use-document-download';
import { Button } from '@/components/ui/button';
import { salesApi } from '@/features/sales/api';
import { deliveryApi } from '../api';

interface Props {
  bookingId: string;
  /** The sale's invoice number, or null while no invoice has been generated. */
  invoiceNumber: string | null;
  bookingCode: string;
  delivered: boolean;
  size?: 'default' | 'sm';
  /** Shown when nothing is available to this user yet (omit to render nothing). */
  emptyText?: string;
}

/**
 * The documents of a booking — one component for the Booking page and the Delivery dialog.
 *
 * Each action only calls the existing endpoint; which invoice a sale gets (GST or legacy) is decided
 * by the server from the sale's own record, never here. Visibility follows the same permissions the
 * server enforces: the invoice needs bookings.view, the delivery note needs delivery.view — a
 * delivery-only user sees no invoice actions at all.
 */
export function DocumentActions({ bookingId, invoiceNumber, bookingCode, delivered, size = 'default', emptyText }: Props): JSX.Element | null {
  const { can } = useAuth();
  const { run, isBusy } = useDocumentDownload();

  const showInvoice = Boolean(invoiceNumber) && can('bookings.view');
  const showNote = delivered && can('delivery.view');
  if (!showInvoice && !showNote) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;

  const invoiceFile = `${(invoiceNumber ?? 'invoice').replace(/\//g, '-')}.pdf`;
  const noteFile = `delivery-${bookingCode}.pdf`;
  const invoice = (key: string, consume: DocumentConsumer) => run(key, () => salesApi.invoicePdf(bookingId), consume, invoiceFile);
  const note = (key: string, consume: DocumentConsumer) => run(key, () => deliveryApi.note(bookingId), consume, noteFile);
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div className="flex flex-wrap gap-2">
      {showInvoice && (
        <>
          <Button size={size} variant="outline" disabled={isBusy('invoice:view')} onClick={() => invoice('invoice:view', openBlob)}><Eye className={icon} /> View invoice</Button>
          <Button size={size} variant="outline" disabled={isBusy('invoice:download')} onClick={() => invoice('invoice:download', saveBlob)}><Download className={icon} /> Download PDF</Button>
          <Button size={size} variant="outline" disabled={isBusy('invoice:print')} onClick={() => invoice('invoice:print', printBlob)}><Printer className={icon} /> Print</Button>
        </>
      )}
      {showNote && (
        <>
          <Button size={size} variant="outline" disabled={isBusy('note:view')} onClick={() => note('note:view', openBlob)}><Eye className={icon} /> View delivery note</Button>
          <Button size={size} variant="outline" disabled={isBusy('note:download')} onClick={() => note('note:download', saveBlob)}><FileDown className={icon} /> Delivery note PDF</Button>
        </>
      )}
    </div>
  );
}
