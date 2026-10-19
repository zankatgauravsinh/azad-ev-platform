import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type FinancePayMethod, type PurchaseOrderDetailDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { useAccessoryPurchaseMutations } from '@/features/accessories/purchases-hooks';
import { PAY_METHODS } from '@/features/accessories/components/purchase-form-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Accessories arrived against an order: how many of each line came (up to what is still expected), at the line's
 * price unless the bill says otherwise, with the vendor's bill number and date. Saved as an accessory purchase of
 * the order — stock goes up and the bill is owed to the vendor unless paid now.
 */
export function ReceiveAccessoriesDialog({ open, onOpenChange, order }: { open: boolean; onOpenChange: (open: boolean) => void; order: PurchaseOrderDetailDto }): JSX.Element {
  const { create } = useAccessoryPurchaseMutations();
  const qc = useQueryClient();
  const lines = order.lines.filter((l) => l.kind === 'ACCESSORY' && l.quantity > l.received);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayDateInput());
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState<FinancePayMethod>('BANK_TRANSFER');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.quantity - l.received)])));
    setCost(Object.fromEntries(lines.map((l) => [l.id, String(paiseToRupees(l.unitCost))])));
    setBillNo('');
    setBillDate(todayDateInput());
    setPaidNow(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when it opens, not on every reload of the order
  }, [open]);

  const submit = async (): Promise<void> => {
    const items = lines
      .map((l) => ({ line: l, quantity: Math.floor(Number(qty[l.id]) || 0), unitCost: rupeesToPaise(Number(cost[l.id]) || 0) }))
      .filter((x) => x.quantity > 0);
    if (!items.length) return setError('Enter how many arrived');
    const over = items.find((x) => x.quantity > x.line.quantity - x.line.received);
    if (over) return setError(`Only ${over.line.quantity - over.line.received} more of ${over.line.description} ${over.line.quantity - over.line.received === 1 ? 'is' : 'are'} expected`);
    setError(null);
    try {
      const purchase = await create.mutateAsync({
        purchaseOrderId: order.id,
        vendorInvoiceNumber: billNo.trim() || undefined,
        purchaseDate: billDate ? new Date(billDate) : undefined,
        items: items.map((x) => ({ accessoryId: x.line.accessoryId!, quantity: x.quantity, unitCost: x.unitCost, gstRate: x.line.gstRateBp / 100, purchaseOrderLineId: x.line.id })),
        payment: paidNow ? { method } : undefined,
      });
      await Promise.all([['purchase-orders'], ['vendor-payables']].map((queryKey) => qc.invalidateQueries({ queryKey })));
      toast.success(`Received as ${purchase.purchaseNumber} — stock updated`);
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not receive the accessories'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive accessories — {order.poNumber}</DialogTitle>
          <DialogDescription>How many of each arrived. Stock goes up; the bill is owed to {order.vendorName} unless paid now.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_5rem_7rem] items-center gap-2">
              <div>
                <p className="text-sm font-medium">{l.description}</p>
                <p className="text-xs text-muted-foreground">{l.received} of {l.quantity} received · GST {l.gstRateBp / 100}%</p>
              </div>
              <Input aria-label={`How many ${l.description} arrived`} type="number" min={0} max={l.quantity - l.received} step={1} value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
              <Input aria-label={`Price of ${l.description}`} type="number" min={0} step="0.01" value={cost[l.id] ?? ''} onChange={(e) => setCost((c) => ({ ...c, [l.id]: e.target.value }))} title={`Ordered at ${formatPaiseExact(l.unitCost)} before GST`} />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ra-bill">Vendor bill no. (optional)</Label>
            <Input id="ra-bill" maxLength={60} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ra-date">Bill date</Label>
            <Input id="ra-date" type="date" max={todayDateInput()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={paidNow} onCheckedChange={(v) => setPaidNow(Boolean(v))} aria-label="Paid now" /> Paid now
          </label>
          {paidNow && (
            <Select value={method} onValueChange={(v) => setMethod(v as FinancePayMethod)}>
              <SelectTrigger className="w-44" aria-label="Paid by"><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={create.isPending || lines.length === 0}>{create.isPending ? 'Saving…' : 'Receive'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
