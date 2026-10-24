import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { purchaseOrdersApi } from '../api';

export interface LinkStockLine { orderId: string; lineId: string; poNumber: string; description: string; remaining: number; unitCost: string; gstRateBp: number }

const date = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

/**
 * Owner: scooters added to Inventory directly (not received against this order) that belong to the line — same
 * model / variant, on no order, from this vendor or none. Linking counts them as received; a scooter without a
 * purchase price gets the order's price and GST, one with a price keeps its own.
 */
export function LinkStockDialog({ line, onClose }: { line: LinkStockLine; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', 'stock', line.lineId], queryFn: () => purchaseOrdersApi.stockCandidates(line.orderId, line.lineId) });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < line.remaining ? [...p, id] : p));

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await purchaseOrdersApi.linkStock(line.orderId, line.lineId, { unitIds: picked });
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`${picked.length} scooter${picked.length === 1 ? '' : 's'} linked to ${line.poNumber}`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not link the scooters'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Link scooters already in stock</DialogTitle>
          <DialogDescription>
            {line.description} on {line.poNumber} — {line.remaining} still expected. Scooters added straight to Inventory count as received here; a scooter without a purchase price gets the order’s {formatPaiseExact(line.unitCost)} + {line.gstRateBp / 100}% GST.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No scooter of this model in stock can be linked — none outside an order, from this vendor or without a vendor.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.map((c) => {
              const on = picked.includes(c.id);
              const full = !on && picked.length >= line.remaining;
              return (
                <li key={c.id}>
                  <label className={`flex items-start gap-3 p-3 text-sm ${full ? 'opacity-50' : 'cursor-pointer'}`}>
                    <input type="checkbox" aria-label={c.vin} checked={on} disabled={full} onChange={() => toggle(c.id)} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono font-medium">{c.vin}</span> <Badge variant="secondary" className="ml-1">{titleCase(c.status)}</Badge>
                      <span className="block text-xs text-muted-foreground">Added {date(c.addedOn)}{c.purchaseDate ? ` · bought ${date(c.purchaseDate)}` : ''}{c.vendorName ? ` · ${c.vendorName}` : ' · no vendor'}</span>
                      {c.costMissing ? (
                        <span className="block text-xs text-amber-700 dark:text-amber-400">No purchase price yet — the order’s price and GST will be used</span>
                      ) : (
                        <span className="block text-xs text-muted-foreground">Keeps its own price {formatPaiseExact(c.purchasePrice)} + GST {formatPaiseExact(c.purchaseGst)}{c.costDiffers ? ' (differs from the order)' : ''}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || picked.length === 0}>{busy ? 'Linking…' : picked.length === 0 ? 'Link scooters' : `Link ${picked.length} scooter${picked.length === 1 ? '' : 's'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
