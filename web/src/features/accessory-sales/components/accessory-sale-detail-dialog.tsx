import { useEffect, useState } from 'react';
import { Ban, FileDown, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { addAccessorySalePaymentSchema, cancelAccessorySaleSchema, type AccessoryPaymentStatus, type PaymentMode } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { saveBlob } from '@/lib/download';
import { formatPaiseExact, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { accessorySalesApi } from '../api';
import { useAccessorySale, useAccessorySaleMutations } from '../hooks';
import { SALE_PAYMENT_MODES } from './accessory-sale-form-dialog';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');
const pct = (bp: number): string => `${bp / 100}%`;
const modeLabel = (m: string): string => SALE_PAYMENT_MODES.find((x) => x.value === m)?.label ?? m;

export const PAYMENT_STATUS_BADGE: Record<AccessoryPaymentStatus, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  PAID: { label: 'Paid', variant: 'success' },
  PARTIAL: { label: 'Part paid', variant: 'warning' },
  PENDING: { label: 'Unpaid', variant: 'muted' },
};

/** One accessory sale: lines, totals, payments; record a payment, download the invoice, cancel (owner / manager). */
export function AccessorySaleDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }): JSX.Element {
  const canSell = useCan('accessories.sell');
  const canCancel = useCan('accessories.cancel');
  const { data: s } = useAccessorySale(id);
  const [mode, setMode] = useState<'pay' | 'cancel' | null>(null);

  useEffect(() => {
    if (!id) setMode(null);
  }, [id]);

  const active = s?.status === 'ACTIVE';
  const download = async (): Promise<void> => {
    if (!s) return;
    try {
      saveBlob(await accessorySalesApi.pdf(s.id), `accessory-invoice-${s.invoiceNumber}.pdf`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!s ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{s.invoiceNumber}</span>
                {active ? <Badge variant={PAYMENT_STATUS_BADGE[s.paymentStatus].variant}>{PAYMENT_STATUS_BADGE[s.paymentStatus].label}</Badge> : <Badge variant="destructive">Cancelled</Badge>}
                {s.gstApplied && <Badge variant="muted">GST</Badge>}
              </DialogTitle>
              <DialogDescription>
                {s.customer.name} · {s.customer.phone} · {fmt(s.invoiceDate)}
                {s.booking ? ` · booking ${s.booking.code}` : ''}
                {s.createdByName ? ` · by ${s.createdByName}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void download()}>
                <FileDown className="h-4 w-4" /> Invoice
              </Button>
              {active && canSell && s.balance !== '0' && mode === null && (
                <Button size="sm" onClick={() => setMode('pay')}>
                  <IndianRupee className="h-4 w-4" /> Record payment
                </Button>
              )}
              {active && canCancel && mode === null && (
                <Button size="sm" variant="outline" onClick={() => setMode('cancel')}>
                  <Ban className="h-4 w-4" /> Cancel sale
                </Button>
              )}
            </div>

            {s.status === 'CANCELLED' && (
              <p role="note" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                Cancelled{s.cancelledAt ? ` on ${fmt(s.cancelledAt)}` : ''}{s.cancelledByName ? ` by ${s.cancelledByName}` : ''}: {s.cancelReason}. The pieces went back into stock{s.refunded !== '0' ? ` and ${formatPaiseExact(s.refunded)} was refunded` : ''}.
              </p>
            )}
            {mode === 'pay' && <PaymentForm id={s.id} balance={s.balance} onDone={() => setMode(null)} />}
            {mode === 'cancel' && <CancelForm id={s.id} paid={s.paid} onDone={() => setMode(null)} />}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  {s.gstApplied && <TableHead className="text-right">GST</TableHead>}
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.name}</p>
                      {(i.sku || (s.gstApplied && i.hsnCode)) && <p className="text-xs text-muted-foreground">{[i.sku, s.gstApplied && i.hsnCode ? `HSN ${i.hsnCode}` : null].filter(Boolean).join(' · ')}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(i.unitPrice)}</TableCell>
                    {s.gstApplied && <TableCell className="text-right tabular-nums text-xs">{pct(i.gstRateBp)} · {formatPaiseExact(i.gstAmount)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(i.lineTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Totals">
              {s.gstApplied && (
                <>
                  <Line label="Taxable value" value={s.subtotal} />
                  {s.supplyType === 'INTER' ? <Line label="IGST" value={s.igst} /> : (<><Line label="CGST" value={s.cgst} /><Line label="SGST" value={s.sgst} /></>)}
                </>
              )}
              <Line label="Total" value={s.total} strong />
              <Line label="Paid" value={s.paid} />
              {active ? <Line label="Balance" value={s.balance} strong /> : s.refunded !== '0' && <Line label="Refunded" value={s.refunded} />}
            </dl>

            {s.payments.length > 0 && (
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Payments</h3>
                <ul className="divide-y rounded-lg border text-sm">
                  {s.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 px-3 py-2">
                      <span>
                        {fmt(p.paidAt)} · {modeLabel(p.mode)}
                        {p.reference ? ` · ${p.reference}` : ''}
                        <span className="block text-xs text-muted-foreground">{p.receiptNumber}{p.receivedByName ? ` · ${p.receivedByName}` : ''}</span>
                      </span>
                      <span className="tabular-nums">{formatPaiseExact(p.amount)}</span>
                    </li>
                  ))}
                  {s.refunds.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2 px-3 py-2 text-destructive">
                      <span>
                        {fmt(r.refundedAt)} · Refund ({modeLabel(r.method)}){r.reference ? ` · ${r.reference}` : ''}
                        <span className="block text-xs">{r.refundNumber}</span>
                      </span>
                      <span className="tabular-nums">−{formatPaiseExact(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {s.notes && <p className="text-sm text-muted-foreground">Note: {s.notes}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatPaiseExact(value)}</dd>
    </div>
  );
}

function ModeSelect({ id, value, onChange }: { id: string; value: PaymentMode; onChange: (m: PaymentMode) => void }): JSX.Element {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PaymentMode)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SALE_PAYMENT_MODES.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaymentForm({ id, balance, onDone }: { id: string; balance: string; onDone: () => void }): JSX.Element {
  const { addPayment } = useAccessorySaleMutations();
  const [amount, setAmount] = useState(String(paiseToRupees(balance)));
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const parsed = addAccessorySalePaymentSchema.safeParse({ amount: rupeesToPaise(Number(amount) || 0), mode, reference: reference.trim() || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the payment');
    if (parsed.data.amount > Number(balance)) return setError(`At most the balance of ${formatPaiseExact(balance)}`);
    setError(null);
    try {
      await addPayment.mutateAsync({ id, body: parsed.data });
      toast.success('Payment recorded');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not record the payment'));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Record payment">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="apay-amount">Amount (₹)</Label>
          <Input id="apay-amount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apay-mode">Mode</Label>
          <ModeSelect id="apay-mode" value={mode} onChange={setMode} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apay-ref">Reference (optional)</Label>
          <Input id="apay-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={addPayment.isPending}>{addPayment.isPending ? 'Saving…' : 'Save payment'}</Button>
      </div>
    </div>
  );
}

function CancelForm({ id, paid, onDone }: { id: string; paid: string; onDone: () => void }): JSX.Element {
  const { cancel } = useAccessorySaleMutations();
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState<PaymentMode>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasPaid = paid !== '0';

  const save = async (): Promise<void> => {
    const parsed = cancelAccessorySaleSchema.safeParse({ reason, refundMode: hasPaid ? refundMode : undefined, refundReference: hasPaid ? reference.trim() || undefined : undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the cancellation');
    setError(null);
    try {
      await cancel.mutateAsync({ id, body: parsed.data });
      toast.success('Sale cancelled — stock returned');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not cancel the sale'));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="group" aria-label="Cancel sale">
      <p className="text-sm">The pieces go back into stock{hasPaid ? ` and the ${formatPaiseExact(paid)} paid is refunded` : ''}. The invoice number stays, marked cancelled.</p>
      <div className="space-y-1.5">
        <Label htmlFor="acancel-reason">Reason</Label>
        <Input id="acancel-reason" maxLength={500} placeholder="e.g. Wrong item billed" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {hasPaid && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="acancel-mode">Refund by</Label>
            <ModeSelect id="acancel-mode" value={refundMode} onChange={setRefundMode} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acancel-ref">Refund reference (optional)</Label>
            <Input id="acancel-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Keep sale</Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => void save()} disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel sale'}</Button>
      </div>
    </div>
  );
}
