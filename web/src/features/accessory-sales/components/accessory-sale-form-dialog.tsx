import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACCESSORY_SALE_MAX_LINES,
  RTO_SUPPLY_TYPE_LABEL,
  createAccessorySaleSchema,
  splitInclusiveGst,
  type PaymentMode,
  type RtoSupplyType,
} from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { CustomerCombobox } from '@/features/sales/components/customer-combobox';
import { useAccessoryList } from '@/features/accessories/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccessorySaleDefaults, useAccessorySaleMutations } from '../hooks';

export const SALE_PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
];
const NO_BOOKING = '__none__';

interface Line {
  accessoryId: string;
  qty: string;
  /** Rupees, as typed. */
  price: string;
}

/**
 * A new accessory counter sale: customer (and optionally one of their bookings), the accessories with quantity and
 * price (catalogue price by default, can be changed), and what is paid now. Its own invoice — never the scooter's.
 */
export function AccessorySaleFormDialog({
  open,
  onOpenChange,
  preset,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: { customerId: string; customerName: string; bookingId?: string };
  onDone?: (saleId: string) => void;
}): JSX.Element {
  const { create } = useAccessorySaleMutations();
  const [customerId, setCustomerId] = useState('');
  const [bookingId, setBookingId] = useState(NO_BOOKING);
  const [lines, setLines] = useState<Line[]>([]);
  const [supplyType, setSupplyType] = useState<RtoSupplyType | null>(null);
  const [paidNow, setPaidNow] = useState('');
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: catalogue = [] } = useAccessoryList({ status: 'active' });
  const { data: defaults } = useAccessorySaleDefaults(customerId || undefined, open);

  useEffect(() => {
    if (!open) return;
    setCustomerId(preset?.customerId ?? '');
    setBookingId(preset?.bookingId ?? NO_BOOKING);
    setLines([]);
    setSupplyType(null);
    setPaidNow('');
    setMode('CASH');
    setReference('');
    setNotes('');
    setError(null);
  }, [open, preset?.customerId, preset?.bookingId]);

  const byId = useMemo(() => new Map(catalogue.map((a) => [a.id, a])), [catalogue]);
  const supply: RtoSupplyType = supplyType ?? defaults?.supplyType ?? 'INTRA';
  const gstOn = Boolean(defaults?.gstEnabled);

  const figures = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
      const unit = BigInt(rupeesToPaise(Number(l.price) || 0));
      const total = unit * BigInt(qty);
      const rateBp = gstOn ? (defaults?.rates[l.accessoryId]?.gstRateBp ?? defaults?.defaultGstRateBp ?? 0) : 0;
      return { total, rateBp, split: splitInclusiveGst(total, rateBp, supply) };
    });
    const sum = (f: (r: (typeof rows)[number]) => bigint): bigint => rows.reduce((a, r) => a + f(r), 0n);
    return { rows, total: sum((r) => r.total), taxable: sum((r) => r.split.taxable), cgst: sum((r) => r.split.cgst), sgst: sum((r) => r.split.sgst), igst: sum((r) => r.split.igst) };
  }, [lines, gstOn, defaults, supply]);

  const unused = catalogue.filter((a) => !lines.some((l) => l.accessoryId === a.id));
  const addLine = (id: string): void => {
    const a = byId.get(id);
    if (!a) return;
    setLines((ls) => [...ls, { accessoryId: id, qty: '1', price: String(paiseToRupees(a.sellPrice)) }]);
  };
  const setLine = (i: number, patch: Partial<Line>): void => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (): Promise<void> => {
    const short = lines.find((l) => Number(l.qty) > (byId.get(l.accessoryId)?.available ?? 0));
    if (short) {
      const a = byId.get(short.accessoryId);
      setError(`Only ${Math.max(0, a?.available ?? 0)} of ${a?.name ?? 'this item'} available`);
      return;
    }
    const paid = paidNow.trim() === '' ? 0 : rupeesToPaise(Number(paidNow));
    const parsed = createAccessorySaleSchema.safeParse({
      customerId,
      bookingId: bookingId === NO_BOOKING ? undefined : bookingId,
      supplyType: gstOn ? supply : undefined,
      items: lines.map((l) => ({ accessoryId: l.accessoryId, qty: l.qty, unitPrice: rupeesToPaise(Number(l.price) || 0) })),
      notes: notes.trim() || undefined,
      payment: paid > 0 ? { amount: paid, mode, reference: reference.trim() || undefined } : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the sale');
      return;
    }
    if (paid > Number(figures.total)) {
      setError(`Paid now cannot be more than the total ${formatPaiseExact(figures.total.toString())}`);
      return;
    }
    setError(null);
    try {
      const sale = await create.mutateAsync(parsed.data);
      toast.success(`Invoice ${sale.invoiceNumber} created`);
      onOpenChange(false);
      onDone?.(sale.id);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not create the sale'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sell accessories</DialogTitle>
          <DialogDescription>A separate accessories invoice — not added to the scooter invoice. Stock leaves when you save.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="asale-customer">Customer</Label>
            {preset?.customerId ? (
              <Input id="asale-customer" readOnly className="bg-muted" value={preset.customerName} aria-readonly />
            ) : (
              <CustomerCombobox id="asale-customer" value={customerId} onChange={(id) => { setCustomerId(id); setBookingId(NO_BOOKING); setSupplyType(null); }} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asale-booking">Booking (optional)</Label>
            <Select value={bookingId} onValueChange={setBookingId} disabled={!customerId}>
              <SelectTrigger id="asale-booking" aria-label="Booking">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BOOKING}>No booking</SelectItem>
                {(defaults?.bookings ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.code} · {b.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <section className="space-y-2" aria-label="Accessories">
          {lines.length > 0 && (
            <div className="hidden grid-cols-[1fr_5rem_7rem_7rem_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
              <span>Accessory</span>
              <span>Qty</span>
              <span>Price each (₹)</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
          )}
          {lines.map((l, i) => {
            const a = byId.get(l.accessoryId);
            return (
              <div key={l.accessoryId} className="grid grid-cols-[1fr_5rem_7rem_2.25rem] items-center gap-2 sm:grid-cols-[1fr_5rem_7rem_7rem_2.25rem]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a?.name ?? 'Accessory'}</p>
                  <p className="text-xs text-muted-foreground">{a ? `${a.available} available` : ''}</p>
                </div>
                <Input aria-label={`Quantity of ${a?.name ?? 'accessory'}`} type="number" min={1} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <Input aria-label={`Price of ${a?.name ?? 'accessory'}`} type="number" min={0} step="0.01" inputMode="decimal" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                <span className="hidden text-right text-sm tabular-nums sm:block">{formatPaiseExact((figures.rows[i]?.total ?? 0n).toString())}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${a?.name ?? 'accessory'}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {lines.length < ACCESSORY_SALE_MAX_LINES && (
            <Select value="" onValueChange={addLine}>
              <SelectTrigger aria-label="Add an accessory" className="w-full sm:w-72">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Plus className="h-4 w-4" /> Add an accessory
                </span>
              </SelectTrigger>
              <SelectContent>
                {unused.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No more active accessories</p>}
                {unused.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.available <= 0}>
                    {a.name} · {formatPaiseExact(a.sellPrice)} · {a.available > 0 ? `${a.available} available` : 'out of stock'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </section>

        <dl className="space-y-1 rounded-lg border p-3 text-sm" aria-label="Invoice total">
          {gstOn && (
            <>
              <Row label="Taxable value" value={figures.taxable} />
              {supply === 'INTER' ? <Row label="IGST" value={figures.igst} /> : (<><Row label="CGST" value={figures.cgst} /><Row label="SGST" value={figures.sgst} /></>)}
            </>
          )}
          <Row label="Total" value={figures.total} strong />
          <p className="pt-1 text-xs text-muted-foreground">{gstOn ? 'Prices include GST (GST on accessory invoices is on in Settings).' : 'No GST on this invoice (turned off in Settings).'}</p>
        </dl>

        {gstOn && (
          <div className="space-y-1.5">
            <Label htmlFor="asale-supply">Supply</Label>
            <Select value={supply} onValueChange={(v) => setSupplyType(v as RtoSupplyType)}>
              <SelectTrigger id="asale-supply" className="sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTRA">{RTO_SUPPLY_TYPE_LABEL.INTRA}</SelectItem>
                <SelectItem value="INTER">{RTO_SUPPLY_TYPE_LABEL.INTER}</SelectItem>
              </SelectContent>
            </Select>
            {defaults?.supplyTypeHint && <p className="text-xs text-muted-foreground">{defaults.supplyTypeHint}</p>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="asale-paid">Paid now (₹)</Label>
            <Input id="asale-paid" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
            <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setPaidNow(String(paiseToRupees(figures.total.toString())))}>
              Paid in full
            </button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asale-mode">Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
              <SelectTrigger id="asale-mode">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asale-ref">Reference (optional)</Label>
            <Input id="asale-ref" maxLength={120} placeholder="UTR / card slip" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asale-notes">Note (optional)</Label>
          <Textarea id="asale-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={create.isPending || lines.length === 0 || !customerId}>
            {create.isPending ? 'Saving…' : 'Create invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: bigint; strong?: boolean }): JSX.Element {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatPaiseExact(value.toString())}</dd>
    </div>
  );
}
