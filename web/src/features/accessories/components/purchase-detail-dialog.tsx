import { useEffect, useState } from 'react';
import { Ban, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { cancelAccessoryPurchaseSchema, markAccessoryPurchasePaidSchema, type AccessoryPurchaseDto, type FinancePayMethod } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact } from '@/lib/money';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAccessoryPurchase, useAccessoryPurchaseMutations } from '../purchases-hooks';
import { PAY_METHODS } from './purchase-form-dialog';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'UTC' });
const methodLabel = (m: string | null): string => PAY_METHODS.find((x) => x.value === m)?.label ?? m ?? '';

/** Paid / Unpaid / Cancelled, for lists and the detail header. */
export function PurchaseStatusBadge({ p }: { p: Pick<AccessoryPurchaseDto, 'status' | 'paid'> }): JSX.Element {
  if (p.status === 'CANCELLED') return <Badge variant="destructive">Cancelled</Badge>;
  return p.paid ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Unpaid</Badge>;
}

/** One purchase: the bill, its lines; mark it paid, or cancel it while its pieces are still in stock. */
export function PurchaseDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }): JSX.Element {
  const { data: p } = useAccessoryPurchase(id);
  const [mode, setMode] = useState<'pay' | 'cancel' | null>(null);
  useEffect(() => {
    if (!id) setMode(null);
  }, [id]);
  const active = p?.status === 'ACTIVE';

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!p ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{p.purchaseNumber}</span>
                <PurchaseStatusBadge p={p} />
              </DialogTitle>
              <DialogDescription>
                {p.vendorName ?? 'No vendor'}
                {p.vendorInvoiceNumber ? ` · bill ${p.vendorInvoiceNumber}` : ''} · {fmt(p.purchaseDate)}
                {p.createdByName ? ` · by ${p.createdByName}` : ''}
              </DialogDescription>
            </DialogHeader>

            {active && mode === null && (
              <div className="flex flex-wrap gap-2">
                {!p.paid && (
                  <Button size="sm" onClick={() => setMode('pay')}>
                    <IndianRupee className="h-4 w-4" /> Mark paid
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setMode('cancel')}>
                  <Ban className="h-4 w-4" /> Cancel purchase
                </Button>
              </div>
            )}
            {p.paid && p.paidAt && (
              <p className="text-sm text-muted-foreground">
                Paid {fmt(p.paidAt)} by {methodLabel(p.paymentMethod)}
                {p.paymentReference ? ` · ${p.paymentReference}` : ''}
              </p>
            )}
            {p.status === 'CANCELLED' && (
              <p role="note" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                Cancelled{p.cancelledAt ? ` on ${new Date(p.cancelledAt).toLocaleDateString('en-IN')}` : ''}{p.cancelledByName ? ` by ${p.cancelledByName}` : ''}: {p.cancelReason}. Its pieces were taken out of stock.
              </p>
            )}
            {mode === 'pay' && <PayForm id={p.id} billDate={p.purchaseDate.slice(0, 10)} onDone={() => setMode(null)} />}
            {mode === 'cancel' && <CancelForm id={p.id} paid={p.paid} onDone={() => setMode(null)} />}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Accessory</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost each</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.accessoryName}</p>
                      {i.sku && <p className="font-mono text-xs text-muted-foreground">{i.sku}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(i.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{i.gstRateBp ? `${i.gstRateBp / 100}% · ` : ''}{formatPaiseExact(i.gstAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(i.lineTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Bill totals">
              <div className="flex justify-between"><dt>Before GST</dt><dd className="tabular-nums">{formatPaiseExact(p.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>GST</dt><dd className="tabular-nums">{formatPaiseExact(p.gstAmount)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Bill total</dt><dd className="tabular-nums">{formatPaiseExact(p.total)}</dd></div>
            </dl>
            {p.notes && <p className="text-sm text-muted-foreground">Note: {p.notes}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ id, billDate, onDone }: { id: string; billDate: string; onDone: () => void }): JSX.Element {
  const { pay } = useAccessoryPurchaseMutations();
  const [method, setMethod] = useState<FinancePayMethod>('CASH');
  const [paidOn, setPaidOn] = useState(todayDateInput());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    const parsed = markAccessoryPurchasePaidSchema.safeParse({ method, paidAt: paidOn || undefined, reference: reference.trim() || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the payment');
    if (paidOn && paidOn < billDate) return setError('The payment date cannot be before the bill date');
    setError(null);
    try {
      await pay.mutateAsync({ id, body: parsed.data });
      toast.success('Marked paid');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not mark it paid'));
    }
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Mark paid">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="apay-method">Paid by</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as FinancePayMethod)}>
            <SelectTrigger id="apay-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAY_METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apay-on">Paid on</Label>
          <Input id="apay-on" type="date" min={billDate} max={todayDateInput()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apay-ref">Reference (optional)</Label>
          <Input id="apay-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={pay.isPending}>{pay.isPending ? 'Saving…' : 'Save payment'}</Button>
      </div>
    </div>
  );
}

function CancelForm({ id, paid, onDone }: { id: string; paid: boolean; onDone: () => void }): JSX.Element {
  const { cancel } = useAccessoryPurchaseMutations();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    const parsed = cancelAccessoryPurchaseSchema.safeParse({ reason });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Give a reason');
    setError(null);
    try {
      await cancel.mutateAsync({ id, body: parsed.data });
      toast.success('Purchase cancelled — stock taken out');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not cancel the purchase'));
    }
  };
  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="group" aria-label="Cancel purchase">
      <p className="text-sm">
        Its pieces are taken out of stock again (only possible while they are all still in stock) and the bill stops counting for the vendor, GST and{paid ? ' the cash book — record the vendor’s refund if they pay you back' : ' the vendor’s outstanding'}.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="acp-reason">Reason</Label>
        <Input id="acp-reason" maxLength={500} placeholder="e.g. Entered twice" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Keep purchase</Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => void save()} disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel purchase'}</Button>
      </div>
    </div>
  );
}
