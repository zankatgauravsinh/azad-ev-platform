import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InvoiceGstBreakdownDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi } from '../api';
import { useSalesInvalidate } from '../hooks';

const date = (d: string): string => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN');

function Breakdown({ title, b }: { title: string; b: InvoiceGstBreakdownDto }): JSX.Element {
  const intra = b.supplyType === 'INTRA';
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">Version {b.version} · {intra ? 'Intra-state' : 'Inter-state'} · {b.placeOfSupply}</span>
      </div>
      <p className="text-sm">{b.buyerGstin ? <>B2B — buyer GSTIN <span className="font-mono">{b.buyerGstin}</span></> : 'B2C — unregistered buyer'}</p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {b.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="truncate">{l.description}{l.code ? ` · ${l.codeType} ${l.code}` : ''}{l.ratePercent ? ` · ${Number(l.ratePercent)}%` : ` · ${l.treatment.toLowerCase().replace('_', '-')}`}</span>
            <span className="tabular-nums">{formatPaiseExact(l.taxable)} + {formatPaiseExact(l.tax)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Taxable</dt><dd className="tabular-nums">{formatPaiseExact(b.taxable)}</dd></div>
        {intra ? (
          <>
            <div><dt className="text-xs text-muted-foreground">CGST</dt><dd className="tabular-nums">{formatPaiseExact(b.cgst)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">SGST</dt><dd className="tabular-nums">{formatPaiseExact(b.sgst)}</dd></div>
          </>
        ) : (
          <div><dt className="text-xs text-muted-foreground">IGST</dt><dd className="tabular-nums">{formatPaiseExact(b.igst)}</dd></div>
        )}
        <div><dt className="text-xs text-muted-foreground">Total GST</dt><dd className="font-semibold tabular-nums">{formatPaiseExact(b.totalTax)}</dd></div>
      </dl>
    </section>
  );
}

/**
 * gst.manage: give an issued tax invoice its GST breakdown as on its own date — the same invoice number, date and
 * total (prices include GST). Shows the breakdown now and the one it would get, or why it cannot be done; a reason
 * is required and kept in the audit log.
 */
export function RegenerateInvoiceGstDialog({ open, onOpenChange, bookingId }: { open: boolean; onOpenChange: (o: boolean) => void; bookingId: string }): JSX.Element {
  const invalidate = useSalesInvalidate();
  const { data: p, isLoading, refetch } = useQuery({ queryKey: ['sales', 'invoice-gst', bookingId], queryFn: () => salesApi.invoiceGstPreview(bookingId), enabled: open });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const canRun = Boolean(p && !p.blocker && !p.unchanged && p.proposed);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await salesApi.regenerateInvoiceGst(bookingId, { reason: reason.trim() });
      invalidate();
      toast.success(`Invoice ${p!.invoiceNumber} regenerated with GST`);
      setReason('');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not regenerate the invoice'));
      void refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Regenerate invoice with GST</DialogTitle>
          <DialogDescription>
            {p ? `Invoice ${p.invoiceNumber} dated ${date(p.invoiceDate)} keeps its number, date and total (${formatPaiseExact(p.total)}) — only its GST breakdown is worked out as on that date. Give the customer the re-printed copy.` : 'Loading the invoice…'}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !p ? <Skeleton className="h-40 w-full" /> : (
          <div className="space-y-3">
            {p.current ? <Breakdown title="GST on the invoice now" b={p.current} /> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">The invoice has no GST breakdown now.</p>}
            {p.blocker && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{p.blocker}</p>}
            {!p.blocker && p.unchanged && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">The GST breakdown is already up to date — nothing would change.</p>}
            {canRun && p.proposed && (
              <>
                <Breakdown title="After regenerating" b={p.proposed} />
                <div className="space-y-1.5">
                  <Label htmlFor="regen-reason">Reason</Label>
                  <Textarea id="regen-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. invoiced before GST was set up in the app · buyer's GSTIN added" />
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canRun && <Button onClick={() => void submit()} disabled={busy || reason.trim().length < 5}>{busy ? 'Regenerating…' : 'Regenerate invoice'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
