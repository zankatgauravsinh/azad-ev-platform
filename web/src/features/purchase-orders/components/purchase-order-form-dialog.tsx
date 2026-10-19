import { useEffect, useMemo, useState } from 'react';
import { Bike, Puzzle, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  PURCHASE_ORDER_MAX_LINES,
  computeOrderLine,
  createPurchaseOrderSchema,
  type PurchaseOrderDetailDto,
  type PurchaseOrderLineKind,
} from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { useVariants } from '@/features/inventory/hooks';
import { useAccessoryList } from '@/features/accessories/hooks';
import { usePurchaseDefaults } from '@/features/accessories/purchases-hooks';
import { AccessoryPicker } from '@/features/accessories/components/accessory-picker';
import { useCompanySettings } from '@/features/settings/hooks';
import { NO_VENDOR, VendorSelect } from '@/features/vendors/components/vendor-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePurchaseOrderMutations } from '../hooks';

interface Line {
  id?: string;
  kind: PurchaseOrderLineKind;
  itemId: string;
  name: string;
  qty: string;
  /** Price per piece before GST, rupees as typed. */
  cost: string;
  /** GST %, as typed. */
  rate: string;
  /** Already received (an existing line): its item is fixed and it cannot go below this. */
  received: number;
}

/**
 * A purchase order: the vendor, dates, the vendor's PI reference and the lines — scooters (a model / variant /
 * colour from the catalogue) and accessories — with price before GST and GST %. Editing keeps lines that have
 * received stock (their item stays; the quantity cannot go below what arrived).
 */
export function PurchaseOrderFormDialog({
  open,
  onOpenChange,
  order,
  defaultVendorId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: PurchaseOrderDetailDto;
  defaultVendorId?: string;
  onSaved?: (order: PurchaseOrderDetailDto) => void;
}): JSX.Element {
  const { create, update } = usePurchaseOrderMutations();
  const { data: variants = [] } = useVariants(undefined, open);
  const { data: accessories = [] } = useAccessoryList({ status: 'active' });
  const { data: defaults } = usePurchaseDefaults(open);
  const { data: settings } = useCompanySettings(open);
  const scooterRate = Number(settings?.taxPercentage ?? 0) > 0 ? Number(settings!.taxPercentage) : 5;
  const [vendorId, setVendorId] = useState(NO_VENDOR);
  const [orderDate, setOrderDate] = useState(todayDateInput());
  const [expectedDate, setExpectedDate] = useState('');
  const [piNumber, setPiNumber] = useState('');
  const [piDate, setPiDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [variantToAdd, setVariantToAdd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(order);

  useEffect(() => {
    if (!open) return;
    setVendorId(order?.vendorId ?? defaultVendorId ?? NO_VENDOR);
    setOrderDate(order ? order.orderDate.slice(0, 10) : todayDateInput());
    setExpectedDate(order?.expectedDate?.slice(0, 10) ?? '');
    setPiNumber(order?.piNumber ?? '');
    setPiDate(order?.piDate?.slice(0, 10) ?? '');
    setNotes(order?.notes ?? '');
    setLines(
      order?.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        itemId: (l.kind === 'SCOOTER' ? l.variantId : l.accessoryId) ?? '',
        name: l.description,
        qty: String(l.quantity),
        cost: String(paiseToRupees(l.unitCost)),
        rate: String(l.gstRateBp / 100),
        received: l.received,
      })) ?? [],
    );
    setVariantToAdd('');
    setError(null);
  }, [open, order, defaultVendorId]);

  const figures = useMemo(() => {
    const rows = lines.map((l) => computeOrderLine(BigInt(rupeesToPaise(Number(l.cost) || 0)), Math.max(0, Math.floor(Number(l.qty) || 0)), Math.round((Number(l.rate) || 0) * 100)));
    const sum = (f: (r: (typeof rows)[number]) => bigint): bigint => rows.reduce((a, r) => a + f(r), 0n);
    return { rows, taxable: sum((r) => r.taxable), gst: sum((r) => r.gst), total: sum((r) => r.lineTotal) };
  }, [lines]);

  const addScooter = (id: string): void => {
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    setLines((ls) => [...ls, { kind: 'SCOOTER', itemId: v.id, name: `${v.model.brand} ${v.model.name} ${v.name} (${v.colour})`, qty: '1', cost: '', rate: String(scooterRate), received: 0 }]);
    setVariantToAdd('');
  };
  const setLine = (i: number, patch: Partial<Line>): void => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (): Promise<void> => {
    if (lines.some((l) => l.cost.trim() === '')) return setError('Enter the price of each line');
    const short = lines.find((l) => (Number(l.qty) || 0) < l.received);
    if (short) return setError(`${short.name} has ${short.received} received — order at least that many`);
    const parsed = createPurchaseOrderSchema.safeParse({
      vendorId: vendorId === NO_VENDOR ? '' : vendorId,
      orderDate: orderDate || undefined,
      expectedDate: expectedDate || null,
      piNumber: piNumber.trim() || null,
      piDate: piDate || null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        kind: l.kind,
        ...(l.kind === 'SCOOTER' ? { variantId: l.itemId } : { accessoryId: l.itemId }),
        quantity: l.qty,
        unitCost: rupeesToPaise(Number(l.cost) || 0),
        gstRate: Number(l.rate) || 0,
      })),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the order');
    setError(null);
    try {
      const saved = order ? await update.mutateAsync({ id: order.id, body: parsed.data }) : await create.mutateAsync(parsed.data);
      toast.success(order ? `${saved.poNumber} updated` : `Purchase order ${saved.poNumber} created`);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the order'));
    }
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${order!.poNumber}` : 'New purchase order'}</DialogTitle>
          <DialogDescription>What you are ordering from the vendor — scooters and accessories, at the price on their PI.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="po-vendor">Vendor</Label>
            <VendorSelect id="po-vendor" value={vendorId} onChange={setVendorId} allowNone={false} prefer="SCOOTER_SUPPLIER" disabled={isEdit && order!.status !== 'DRAFT'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-date">Order date</Label>
            <Input id="po-date" type="date" max={todayDateInput()} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-pi">Vendor&apos;s PI no. (optional)</Label>
            <Input id="po-pi" maxLength={60} value={piNumber} onChange={(e) => setPiNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-pi-date">PI date</Label>
            <Input id="po-pi-date" type="date" value={piDate} onChange={(e) => setPiDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-expected">Expected by</Label>
            <Input id="po-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
        </div>

        <section className="space-y-2" aria-label="Order lines">
          {lines.length > 0 && (
            <div className="hidden grid-cols-[1fr_4.5rem_7rem_4.5rem_7rem_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
              <span>Item</span>
              <span>Qty</span>
              <span>Price each (₹, before GST)</span>
              <span>GST %</span>
              <span className="text-right">Line total</span>
              <span />
            </div>
          )}
          {lines.map((l, i) => (
            <div key={l.id ?? `${l.kind}:${l.itemId}:${i}`} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-[1fr_4.5rem_7rem_4.5rem_7rem_2.25rem] md:border-0 md:p-0">
              <p className="col-span-2 flex items-center gap-1.5 truncate text-sm font-medium md:col-span-1">
                {l.kind === 'SCOOTER' ? <Bike className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Puzzle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="truncate">{l.name}</span>
                {l.received > 0 && <span className="text-xs font-normal text-muted-foreground">({l.received} received)</span>}
              </p>
              <Input aria-label={`Quantity of ${l.name}`} type="number" min={Math.max(1, l.received)} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <Input aria-label={`Price of ${l.name}`} type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
              <Input aria-label={`GST % of ${l.name}`} type="number" min={0} max={28} step="0.01" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
              <span className="text-right text-sm tabular-nums">{formatPaiseExact((figures.rows[i]?.lineTotal ?? 0n).toString())}</span>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.name}`} disabled={l.received > 0} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {lines.length < PURCHASE_ORDER_MAX_LINES && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={variantToAdd} onValueChange={addScooter}>
                <SelectTrigger aria-label="Add a scooter line"><SelectValue placeholder="+ Add scooters (model / variant / colour)" /></SelectTrigger>
                <SelectContent>
                  {variants.filter((v) => v.isActive !== false).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.model.brand} {v.model.name} · {v.name} · {v.colour}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AccessoryPicker
                accessories={accessories}
                exclude={lines.filter((l) => l.kind === 'ACCESSORY').map((l) => l.itemId)}
                onPick={(a) => setLines((ls) => [...ls, { kind: 'ACCESSORY', itemId: a.id, name: a.name, qty: '1', cost: '', rate: String((defaults?.rates[a.id]?.gstRateBp ?? 1800) / 100), received: 0 }])}
                placeholder="+ Add accessories — type a name…"
              />
            </div>
          )}
        </section>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Order total">
          <div className="flex justify-between"><dt>Before GST</dt><dd className="tabular-nums">{formatPaiseExact(figures.taxable.toString())}</dd></div>
          <div className="flex justify-between"><dt>GST</dt><dd className="tabular-nums">{formatPaiseExact(figures.gst.toString())}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Order total</dt><dd className="tabular-nums">{formatPaiseExact(figures.total.toString())}</dd></div>
        </dl>

        <div className="space-y-1.5">
          <Label htmlFor="po-notes">Notes / terms (optional, printed on the order)</Label>
          <Textarea id="po-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || lines.length === 0 || vendorId === NO_VENDOR}>
            {busy ? 'Saving…' : isEdit ? 'Save order' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
