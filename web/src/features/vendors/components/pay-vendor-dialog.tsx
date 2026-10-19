import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { VENDOR_BILL_KIND_LABEL, type FinancePayMethod, type VendorBillDto, type VendorBillKind, type VendorPaymentDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { PAY_METHODS } from '@/features/accessories/components/purchase-form-dialog';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useVendorBills, useVendorPaymentMutations } from '../payables-hooks';

const keyOf = (b: { kind: VendorBillKind; id: string }): string => `${b.kind}:${b.id}`;
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

export function dueLabel(b: Pick<VendorBillDto, 'paid' | 'daysOverdue'>): { text: string; variant: 'success' | 'destructive' | 'warning' | 'muted' } {
  if (b.paid) return { text: 'Paid', variant: 'success' };
  if (b.daysOverdue > 0) return { text: `${b.daysOverdue} day${b.daysOverdue === 1 ? '' : 's'} overdue`, variant: 'destructive' };
  if (b.daysOverdue === 0) return { text: 'Due today', variant: 'warning' };
  return { text: `Due in ${-b.daysOverdue} day${b.daysOverdue === -1 ? '' : 's'}`, variant: 'muted' };
}

/**
 * Pay a vendor: tick the bills this payment settles (each in full, or type a part), and the amount paid. Anything
 * paid above the bills ticked stays with the vendor as an advance. With `applyFrom`, it applies the advance left on
 * an earlier payment to bills instead (no new money).
 */
export function PayVendorDialog({
  open,
  onOpenChange,
  vendorId,
  vendorName,
  preselect = [],
  purchaseOrder,
  applyFrom,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  /** Bills ticked when the dialog opens (e.g. the scooter it was opened from). */
  preselect?: { kind: VendorBillKind; id: string }[];
  /** An advance against this purchase order (no bills yet). */
  purchaseOrder?: { id: string; poNumber: string; suggested?: string };
  /** Apply what is left on this payment instead of paying new money. */
  applyFrom?: VendorPaymentDto;
  onDone?: (payment: VendorPaymentDto) => void;
}): JSX.Element {
  const { data: bills, isLoading } = useVendorBills(vendorId, { status: 'unpaid' }, open);
  const { pay, apply } = useVendorPaymentMutations();
  /** Ticked bills → the amount (rupees, as typed) applied to each. */
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<FinancePayMethod>('BANK_TRANSFER');
  const [paidOn, setPaidOn] = useState(todayDateInput());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const preselectKey = preselect.map(keyOf).join(',');

  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    setAmount(purchaseOrder?.suggested ? String(paiseToRupees(purchaseOrder.suggested)) : '');
    setAmountTouched(Boolean(purchaseOrder?.suggested));
    setMethod('BANK_TRANSFER');
    setPaidOn(todayDateInput());
    setReference('');
    setNotes('');
    setError(null);
  }, [open, purchaseOrder?.suggested]);

  // Tick the bills it was opened for, once they have loaded.
  useEffect(() => {
    if (!open || !bills || !preselectKey) return;
    const wanted = new Set(preselectKey.split(','));
    setPicked(new Map(bills.filter((b) => wanted.has(keyOf(b))).map((b) => [keyOf(b), String(paiseToRupees(b.balance))])));
  }, [open, bills, preselectKey]);

  const list = bills ?? [];
  const appliedPaise = useMemo(() => [...picked.values()].reduce((a, v) => a + rupeesToPaise(Number(v) || 0), 0), [picked]);
  const available = applyFrom ? Number(applyFrom.unapplied) : null;
  // The amount paid follows the bills ticked until it is typed.
  const amountPaise = applyFrom ? appliedPaise : amountTouched ? rupeesToPaise(Number(amount) || 0) : appliedPaise;
  const advancePaise = applyFrom ? 0 : Math.max(0, amountPaise - appliedPaise);

  const toggle = (b: VendorBillDto, on: boolean): void =>
    setPicked((m) => {
      const next = new Map(m);
      if (!on) {
        next.delete(keyOf(b));
        return next;
      }
      // Applying an advance: what is left of it, at most the bill.
      const left = applyFrom ? Math.max(0, Number(applyFrom.unapplied) - [...m.values()].reduce((a, v) => a + rupeesToPaise(Number(v) || 0), 0)) : Infinity;
      next.set(keyOf(b), String(paiseToRupees(Math.min(Number(b.balance), left))));
      return next;
    });
  const allPicked = list.length > 0 && list.every((b) => picked.has(keyOf(b)));

  const submit = async (): Promise<void> => {
    const allocations = list
      .filter((b) => picked.has(keyOf(b)))
      .map((b) => ({ kind: b.kind, billId: b.id, amount: rupeesToPaise(Number(picked.get(keyOf(b))) || 0), balance: Number(b.balance), number: b.number }));
    const bad = allocations.find((a) => a.amount <= 0 || a.amount > a.balance);
    if (bad) {
      setError(bad.amount <= 0 ? `Enter what is paid on ${bad.number}` : `Only ${formatPaise(bad.balance)} is owed on ${bad.number}`);
      return;
    }
    const body = allocations.map(({ kind, billId, amount: a }) => ({ kind, billId, amount: a }));
    try {
      if (applyFrom) {
        if (!body.length) return setError('Tick at least one bill');
        if (appliedPaise > (available ?? 0)) return setError(`Only ${formatPaise(available ?? 0)} of the advance is left`);
        const res = await apply.mutateAsync({ id: applyFrom.id, body: { allocations: body } });
        toast.success(`Advance from ${res.paymentNumber} applied`);
        onOpenChange(false);
        onDone?.(res);
        return;
      }
      if (amountPaise <= 0) return setError('Enter the amount paid');
      if (amountPaise < appliedPaise) return setError(`The bills ticked add up to ${formatPaise(appliedPaise)} — more than the amount paid`);
      if (paidOn > todayDateInput()) return setError('The payment date cannot be in the future');
      setError(null);
      const res = await pay.mutateAsync({
        vendorId,
        method,
        paidAt: paidOn ? new Date(paidOn) : undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        amount: amountPaise,
        purchaseOrderId: purchaseOrder?.id,
        allocations: body,
      });
      toast.success(`Payment ${res.paymentNumber} recorded${advancePaise > 0 ? ` — ${formatPaise(advancePaise)} kept as advance` : ''}`);
      onOpenChange(false);
      onDone?.(res);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not record the payment'));
    }
  };

  const busy = pay.isPending || apply.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{applyFrom ? `Apply advance — ${applyFrom.paymentNumber}` : `Pay ${vendorName}`}</DialogTitle>
          <DialogDescription>
            {applyFrom
              ? `${formatPaise(applyFrom.unapplied)} paid earlier is still with ${vendorName}. Tick the bills it settles.`
              : purchaseOrder
                ? `An advance against ${purchaseOrder.poNumber}. Apply it to the bills when the stock arrives.`
                : 'Tick the bills this payment settles — in full, or type a part. Anything paid above them stays as an advance.'}
          </DialogDescription>
        </DialogHeader>

        <section aria-label="Unpaid bills" className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : list.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing is owed to {vendorName} right now{applyFrom ? '' : ' — the whole amount will be an advance'}.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 p-2 text-left">
                      <Checkbox aria-label="Tick all bills" checked={allPicked} onCheckedChange={(v) => list.forEach((b) => toggle(b, Boolean(v)))} />
                    </th>
                    <th className="p-2 text-left">Bill</th>
                    <th className="p-2 text-left">Due</th>
                    <th className="p-2 text-right">Owed</th>
                    <th className="w-36 p-2 text-right">Paying (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const k = keyOf(b);
                    const due = dueLabel(b);
                    return (
                      <tr key={k} className="border-t">
                        <td className="p-2 align-top"><Checkbox aria-label={`Pay ${b.number}`} checked={picked.has(k)} onCheckedChange={(v) => toggle(b, Boolean(v))} /></td>
                        <td className="p-2 align-top">
                          <p className="font-medium"><span className="font-mono text-xs">{b.number}</span> <span className="text-xs text-muted-foreground">· {VENDOR_BILL_KIND_LABEL[b.kind]}</span></p>
                          <p className="text-xs text-muted-foreground">{b.description}{b.vendorBillNumber ? ` · bill ${b.vendorBillNumber}` : ''} · {fmtDate(b.date)}</p>
                        </td>
                        <td className="p-2 align-top"><Badge variant={due.variant}>{due.text}</Badge></td>
                        <td className="p-2 text-right align-top tabular-nums">
                          {formatPaise(b.balance)}
                          {b.allocated !== '0' && <p className="text-xs text-muted-foreground">of {formatPaise(b.amount)}</p>}
                        </td>
                        <td className="p-2 align-top">
                          <Input
                            aria-label={`Amount paying on ${b.number}`}
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            className="text-right"
                            disabled={!picked.has(k)}
                            value={picked.get(k) ?? ''}
                            onChange={(e) => setPicked((m) => new Map(m).set(k, e.target.value))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!applyFrom && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="vpay-amount">Amount paid (₹)</Label>
              <Input
                id="vpay-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amountTouched ? amount : appliedPaise ? String(paiseToRupees(appliedPaise)) : ''}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmount(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vpay-method">Paid by</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as FinancePayMethod)}>
                <SelectTrigger id="vpay-method"><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vpay-date">Paid on</Label>
              <Input id="vpay-date" type="date" max={todayDateInput()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vpay-ref">Reference (optional)</Label>
              <Input id="vpay-ref" maxLength={120} placeholder="UTR / cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="vpay-notes">Note (optional)</Label>
              <Textarea id="vpay-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Payment summary">
          <div className="flex justify-between"><dt>Applied to bills</dt><dd className="tabular-nums">{formatPaise(appliedPaise)}</dd></div>
          {applyFrom ? (
            <div className="flex justify-between text-muted-foreground"><dt>Advance left after this</dt><dd className="tabular-nums">{formatPaise(Math.max(0, (available ?? 0) - appliedPaise))}</dd></div>
          ) : (
            <>
              <div className="flex justify-between text-muted-foreground"><dt>Kept as advance</dt><dd className="tabular-nums">{formatPaise(advancePaise)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total paid</dt><dd className="tabular-nums">{formatPaise(amountPaise)}</dd></div>
            </>
          )}
        </dl>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : applyFrom ? 'Apply advance' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
