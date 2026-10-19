import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { ACCESSORY_PURCHASE_MAX_LINES, computePurchaseLine, createAccessoryPurchaseSchema, type AccessoryDto, type FinancePayMethod } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact, rupeesToPaise } from '@/lib/money';
import { NO_VENDOR, VendorSelect } from '@/features/vendors/components/vendor-select';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccessoryList, useAccessoryMutations } from '../hooks';
import { AccessoryPicker } from './accessory-picker';
import { useAccessoryPurchaseMutations, usePurchaseDefaults } from '../purchases-hooks';

export const PAY_METHODS: { value: FinancePayMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
];

interface Line {
  accessoryId: string;
  qty: string;
  /** Cost per piece before GST, rupees as typed. */
  cost: string;
  /** GST %, as typed. */
  rate: string;
  /** GST amount for the line in rupees, typed from the bill ('' = worked out from the rate). */
  gstAmount: string;
}

/**
 * Accessories bought from a vendor: the supplier bill (vendor, bill number, date), the lines (quantity, cost per
 * piece before GST, GST %), and whether it is paid now. Stock goes up and the average cost is recomputed on save.
 */
export function PurchaseFormDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone?: (id: string) => void }): JSX.Element {
  const { create } = useAccessoryPurchaseMutations();
  const { create: createAccessory } = useAccessoryMutations();
  const { data: listed = [] } = useAccessoryList({ status: 'active' });
  // Accessories added from this form, usable before the catalogue list reloads.
  const [added, setAdded] = useState<AccessoryDto[]>([]);
  const catalogue = useMemo(() => [...listed, ...added.filter((a) => !listed.some((l) => l.id === a.id))], [listed, added]);
  const { data: defaults } = usePurchaseDefaults(open);
  const [vendorId, setVendorId] = useState(NO_VENDOR);
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayDateInput());
  const [lines, setLines] = useState<Line[]>([]);
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState<FinancePayMethod>('CASH');
  const [paidOn, setPaidOn] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVendorId(NO_VENDOR);
    setBillNo('');
    setBillDate(todayDateInput());
    setLines([]);
    setPaidNow(false);
    setMethod('CASH');
    setPaidOn('');
    setReference('');
    setNotes('');
    setError(null);
    setAdded([]);
  }, [open]);

  const byId = useMemo(() => new Map(catalogue.map((a) => [a.id, a])), [catalogue]);
  const figures = useMemo(() => {
    const rows = lines.map((l) =>
      computePurchaseLine(
        BigInt(rupeesToPaise(Number(l.cost) || 0)),
        Math.max(0, Math.floor(Number(l.qty) || 0)),
        l.gstAmount.trim() !== '' ? { amount: BigInt(rupeesToPaise(Number(l.gstAmount) || 0)) } : { rateBp: Math.round((Number(l.rate) || 0) * 100) },
      ),
    );
    const sum = (f: (r: (typeof rows)[number]) => bigint): bigint => rows.reduce((a, r) => a + f(r), 0n);
    return { rows, taxable: sum((r) => r.taxable), gst: sum((r) => r.gst), total: sum((r) => r.lineTotal) };
  }, [lines]);

  const addLine = (a: AccessoryDto): void => {
    const bp = defaults?.rates[a.id]?.gstRateBp ?? 1800;
    setLines((ls) => (ls.some((l) => l.accessoryId === a.id) ? ls : [...ls, { accessoryId: a.id, qty: '1', cost: '', rate: String(bp / 100), gstAmount: '' }]));
  };
  /** A new item bought for the first time: added to the catalogue (selling price set later), then to the bill. */
  const addNew = async (name: string): Promise<void> => {
    try {
      const a = await createAccessory.mutateAsync({ name, sku: null, category: null, sellPrice: 0, minStock: 0, isPart: false });
      setAdded((list) => [...list, a]);
      addLine(a);
      toast.success(`${a.name} added to your accessories — set its selling price on the Stock tab`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not add the accessory'));
    }
  };
  const setLine = (i: number, patch: Partial<Line>): void => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (): Promise<void> => {
    if (lines.some((l) => l.cost.trim() === '')) {
      setError('Enter the cost of each accessory');
      return;
    }
    const parsed = createAccessoryPurchaseSchema.safeParse({
      vendorId: vendorId === NO_VENDOR ? undefined : vendorId,
      vendorInvoiceNumber: billNo.trim() || undefined,
      purchaseDate: billDate || undefined,
      notes: notes.trim() || undefined,
      items: lines.map((l) => ({
        accessoryId: l.accessoryId,
        quantity: l.qty,
        unitCost: rupeesToPaise(Number(l.cost) || 0),
        ...(l.gstAmount.trim() !== '' ? { gstAmount: rupeesToPaise(Number(l.gstAmount) || 0) } : { gstRate: Number(l.rate) || 0 }),
      })),
      payment: paidNow ? { method, paidAt: paidOn || undefined, reference: reference.trim() || undefined } : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the purchase');
      return;
    }
    if (billDate > todayDateInput()) {
      setError('The bill date cannot be in the future');
      return;
    }
    setError(null);
    try {
      const purchase = await create.mutateAsync(parsed.data);
      toast.success(`Purchase ${purchase.purchaseNumber} saved — stock updated`);
      onOpenChange(false);
      onDone?.(purchase.id);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the purchase'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New purchase</DialogTitle>
          <DialogDescription>Accessories bought from a vendor. Stock and the average cost update when you save.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="apur-vendor">Vendor</Label>
            <VendorSelect id="apur-vendor" value={vendorId} onChange={setVendorId} prefer="ACCESSORIES" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apur-bill">Bill no. (optional)</Label>
            <Input id="apur-bill" maxLength={60} placeholder="Supplier's invoice no." value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apur-date">Bill date</Label>
            <Input id="apur-date" type="date" max={todayDateInput()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
        </div>

        <section className="space-y-2" aria-label="Accessories bought">
          {lines.length > 0 && (
            <div className="hidden grid-cols-[1fr_4.5rem_6.5rem_4.5rem_6.5rem_7rem_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
              <span>Accessory</span>
              <span>Qty</span>
              <span>Cost each (₹, before GST)</span>
              <span>GST %</span>
              <span>GST (₹)</span>
              <span className="text-right">Line total</span>
              <span />
            </div>
          )}
          {lines.map((l, i) => {
            const a = byId.get(l.accessoryId);
            const row = figures.rows[i];
            return (
              <div key={l.accessoryId} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-[1fr_4.5rem_6.5rem_4.5rem_6.5rem_7rem_2.25rem] md:border-0 md:p-0">
                <p className="col-span-2 truncate text-sm font-medium md:col-span-1">{a?.name ?? 'Accessory'}</p>
                <Input aria-label={`Quantity of ${a?.name ?? 'accessory'}`} type="number" min={1} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <Input aria-label={`Cost of ${a?.name ?? 'accessory'}`} type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
                <Input aria-label={`GST % of ${a?.name ?? 'accessory'}`} type="number" min={0} max={28} step="0.01" inputMode="decimal" disabled={l.gstAmount.trim() !== ''} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                <Input
                  aria-label={`GST amount of ${a?.name ?? 'accessory'}`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={row ? (Number(row.gst) / 100).toFixed(2) : ''}
                  title="Leave blank to work it out from the GST %; type it to match the bill"
                  value={l.gstAmount}
                  onChange={(e) => setLine(i, { gstAmount: e.target.value })}
                />
                <span className="text-right text-sm tabular-nums">{formatPaiseExact((row?.lineTotal ?? 0n).toString())}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${a?.name ?? 'accessory'}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {lines.length < ACCESSORY_PURCHASE_MAX_LINES && (
            <AccessoryPicker accessories={catalogue} exclude={lines.map((l) => l.accessoryId)} onPick={addLine} onCreate={addNew} placeholder="Type the accessory name, e.g. helmet…" />
          )}
          <p className="text-xs text-muted-foreground">GST is worked out from the GST %; type the GST amount instead when the bill shows a different figure.</p>
        </section>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Purchase total">
          <div className="flex justify-between"><dt>Before GST</dt><dd className="tabular-nums">{formatPaiseExact(figures.taxable.toString())}</dd></div>
          <div className="flex justify-between"><dt>GST</dt><dd className="tabular-nums">{formatPaiseExact(figures.gst.toString())}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Bill total</dt><dd className="tabular-nums">{formatPaiseExact(figures.total.toString())}</dd></div>
        </dl>

        <div className="space-y-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={paidNow} onCheckedChange={(v) => setPaidNow(Boolean(v))} aria-label="Paid now" />
            Paid now
          </label>
          {paidNow ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="apur-method">Paid by</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as FinancePayMethod)}>
                  <SelectTrigger id="apur-method">
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
                <Label htmlFor="apur-paid-on">Paid on</Label>
                <Input id="apur-paid-on" type="date" min={billDate} max={todayDateInput()} value={paidOn || billDate} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apur-ref">Reference (optional)</Label>
                <Input id="apur-ref" maxLength={120} placeholder="UTR / cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Not paid yet: the bill shows as the vendor&apos;s outstanding until you mark it paid.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apur-notes">Note (optional)</Label>
          <Textarea id="apur-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={create.isPending || lines.length === 0}>
            {create.isPending ? 'Saving…' : 'Save purchase'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
