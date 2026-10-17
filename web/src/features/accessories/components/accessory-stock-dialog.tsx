import { useEffect, useState } from 'react';
import { Minus, PackagePlus, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACCESSORY_STOCK_STEP_MAX,
  PURCHASE_COST_PERMISSION,
  openingStockSchema,
  stockAdjustmentSchema,
  type AccessoryMovementDto,
  type AccessoryMovementType,
} from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, formatPaiseExact, rupeesToPaise } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAccessory, useAccessoryMutations } from '../hooks';

const MOVEMENT_LABELS: Record<AccessoryMovementType, string> = {
  OPENING: 'Opening stock',
  PURCHASE_IN: 'Purchase',
  SALE_OUT: 'Sold',
  ADJUSTMENT: 'Adjustment',
  RESERVE: 'Reserved',
  RELEASE: 'Released',
  SALE_RETURN: 'Sale cancelled',
  PURCHASE_RETURN: 'Purchase cancelled',
};

/** Signed quantity as the ledger moved it: reservations change "reserved", not "on hand". */
const signed = (m: AccessoryMovementDto): string => {
  const out = m.type === 'SALE_OUT' || m.type === 'PURCHASE_RETURN' || m.quantity < 0;
  const n = Math.abs(m.quantity);
  return out ? `−${n}` : `+${n}`;
};

/**
 * One accessory's stock: on hand / reserved / available, the stock ledger, and — for managers — opening stock
 * (owner only: it sets the average cost) and counted adjustments.
 */
export function AccessoryStockDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }): JSX.Element {
  const canManage = useCan('accessories.manage');
  const canSeeCost = useCan(PURCHASE_COST_PERMISSION);
  const { data: a } = useAccessory(id);
  const [mode, setMode] = useState<'opening' | 'adjust' | null>(null);

  useEffect(() => {
    if (!id) setMode(null);
  }, [id]);

  const canOpening = canManage && canSeeCost && Boolean(a?.openingAllowed);

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!a ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {a.name}
                {a.sku && <span className="font-mono text-sm font-normal text-muted-foreground">{a.sku}</span>}
                {!a.isActive && <Badge variant="muted">Inactive</Badge>}
              </DialogTitle>
              <DialogDescription>Stock changes here are kept in the ledger below.</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4" aria-label="Stock">
              <Figure label="On hand" value={a.onHand} />
              <Figure label="Reserved" value={a.reserved} />
              <Figure label="Available" value={a.available} tone={a.available <= 0 ? 'text-destructive' : a.lowStock ? 'text-amber-600' : undefined} />
              {canSeeCost ? <Figure label="Avg cost" value={a.avgCost && a.avgCost !== '0' ? formatPaiseExact(a.avgCost) : '—'} /> : <Figure label="Alert at" value={a.minStock} />}
            </dl>

            {canManage && mode === null && (
              <div className="flex flex-wrap gap-2">
                {canOpening && (
                  <Button size="sm" onClick={() => setMode('opening')}>
                    <PackagePlus className="h-4 w-4" /> Opening stock
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setMode('adjust')}>
                  <SlidersHorizontal className="h-4 w-4" /> Adjust stock
                </Button>
              </div>
            )}
            {canManage && !canSeeCost && a.openingAllowed && mode === null && (
              <p className="text-xs text-muted-foreground">Opening stock sets the item&apos;s cost, so only the owner enters it.</p>
            )}
            {mode === 'opening' && <OpeningForm id={a.id} onDone={() => setMode(null)} />}
            {mode === 'adjust' && <AdjustForm id={a.id} name={a.name} onHand={a.onHand} reserved={a.reserved} onDone={() => setMode(null)} />}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Stock history</h3>
              {a.movements.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No stock yet.{canOpening ? ' Enter the pieces you already have with “Opening stock”.' : ''}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Movement</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      {canSeeCost && <TableHead className="text-right">Cost each</TableHead>}
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-xs">{new Date(m.createdAt).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell>{MOVEMENT_LABELS[m.type]}</TableCell>
                        <TableCell className="text-right tabular-nums">{signed(m)}</TableCell>
                        {canSeeCost && <TableCell className="text-right tabular-nums">{m.unitCost ? formatPaise(m.unitCost) : '—'}</TableCell>}
                        <TableCell className="text-right tabular-nums">{m.onHandAfter}</TableCell>
                        <TableCell className="max-w-[14rem] text-xs text-muted-foreground">
                          {m.note ?? '—'}
                          {m.createdByName && <span className="block">by {m.createdByName}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}

/** Owner: pieces already in the showroom and what each cost (ex-GST). */
function OpeningForm({ id, onDone }: { id: string; onDone: () => void }): JSX.Element {
  const { openingStock } = useAccessoryMutations();
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const parsed = openingStockSchema.safeParse({ quantity, unitCost: cost === '' ? undefined : rupeesToPaise(Number(cost)), note: note.trim() || undefined });
    if (!parsed.success || cost === '' || Number(cost) < 0) {
      setError(cost === '' ? 'Enter the cost of one piece' : Number(cost) < 0 ? 'Cost cannot be negative' : (parsed.error?.issues[0]?.message ?? 'Check the quantity'));
      return;
    }
    setError(null);
    try {
      await openingStock.mutateAsync({ id, body: parsed.data });
      toast.success('Opening stock added');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not add the opening stock'));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Opening stock">
      <p className="text-sm font-medium">Opening stock</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="opening-qty">Pieces in stock</Label>
          <Input id="opening-qty" type="number" min={1} max={ACCESSORY_STOCK_STEP_MAX} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opening-cost">Cost of one piece (₹, without GST)</Label>
          <Input id="opening-cost" type="number" min={0} step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="opening-note">Note (optional)</Label>
          <Input id="opening-note" maxLength={300} placeholder="e.g. Counted on 1 October" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">You can add opening stock in more than one lot until the first purchase or adjustment; the average cost is worked out across lots.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={openingStock.isPending}>{openingStock.isPending ? 'Saving…' : 'Add opening stock'}</Button>
      </div>
    </div>
  );
}

/** Counted correction: add found pieces or remove damaged / lost ones, with a reason. */
function AdjustForm({ id, name, onHand, reserved, onDone }: { id: string; name: string; onHand: number; reserved: number; onDone: () => void }): JSX.Element {
  const { adjust } = useAccessoryMutations();
  const [direction, setDirection] = useState<'add' | 'remove'>('remove');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const removable = Math.max(0, onHand - reserved);

  const save = async (): Promise<void> => {
    const n = Number(quantity);
    const parsed = stockAdjustmentSchema.safeParse({ delta: direction === 'add' ? n : -n, reason });
    if (!quantity || n <= 0) {
      setError('Enter how many pieces');
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the adjustment');
      return;
    }
    if (direction === 'remove' && n > removable) {
      setError(reserved > 0 ? `Only ${removable} can be removed — ${reserved} reserved for bookings` : `Only ${onHand} in stock`);
      return;
    }
    setError(null);
    try {
      await adjust.mutateAsync({ id, body: parsed.data });
      toast.success(`Stock of ${name} adjusted`);
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not adjust the stock'));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Adjust stock">
      <p className="text-sm font-medium">Adjust stock</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Direction">
        <Button type="button" size="sm" role="radio" aria-checked={direction === 'remove'} variant={direction === 'remove' ? 'default' : 'outline'} onClick={() => setDirection('remove')}>
          <Minus className="h-4 w-4" /> Remove
        </Button>
        <Button type="button" size="sm" role="radio" aria-checked={direction === 'add'} variant={direction === 'add' ? 'default' : 'outline'} onClick={() => setDirection('add')}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="adjust-qty">Pieces</Label>
          <Input id="adjust-qty" type="number" min={1} max={ACCESSORY_STOCK_STEP_MAX} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          {direction === 'remove' && <p className="text-xs text-muted-foreground">Up to {removable} can be removed{reserved > 0 ? ` (${reserved} reserved for bookings)` : ''}.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-reason">Reason</Label>
          <Input id="adjust-reason" maxLength={300} placeholder={direction === 'remove' ? 'e.g. Damaged, lost' : 'e.g. Found in store room'} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Purchases are entered separately; use this only to correct the count. The average cost does not change.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={adjust.isPending}>{adjust.isPending ? 'Saving…' : 'Save adjustment'}</Button>
      </div>
    </div>
  );
}
