import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TaxClassificationDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTaxMutations } from '../hooks';

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');

export function RatesDialog({
  open,
  onOpenChange,
  classification,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classification: TaxClassificationDto | null;
}): JSX.Element {
  const { addRate, removeRate } = useTaxMutations();
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const reset = (): void => { setRate(''); setFrom(''); setTo(''); };

  const add = async (): Promise<void> => {
    if (!classification) return;
    if (!from) { toast.error('Effective-from is required'); return; }
    const pct = Number(rate);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { toast.error('Enter a rate between 0 and 100'); return; }
    try {
      await addRate.mutateAsync({ classificationId: classification.id, input: { ratePercent: pct, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null } });
      toast.success('Rate added');
      reset();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not add the rate'));
    }
  };

  const del = async (rateId: string): Promise<void> => {
    try {
      await removeRate.mutateAsync(rateId);
      toast.success('Rate removed');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not remove the rate'));
    }
  };

  const rates = classification?.rates ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rates · {classification?.name ?? ''}</DialogTitle>
          <DialogDescription>A single combined GST rate per period. CGST/SGST/IGST is split later by the tax engine, not here.</DialogDescription>
        </DialogHeader>

        {rates.length === 0 ? (
          <EmptyState title="No rates yet" description="Add the first effective-dated rate below." />
        ) : (
          <ul className="divide-y text-sm">
            {rates.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-semibold tabular-nums">{r.ratePercent}%</span>
                  <span className="ml-2 text-muted-foreground">{fmt(r.effectiveFrom)} → {r.effectiveTo ? fmt(r.effectiveTo) : 'open'}</span>
                  {!r.isActive && <Badge variant="muted" className="ml-2">Inactive</Badge>}
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Remove rate" onClick={() => void del(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-4">
          <div className="space-y-1.5"><Label>Rate %</Label><Input type="number" min={0} max={100} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Effective to</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="flex items-end"><Button type="button" className="w-full" disabled={addRate.isPending} onClick={() => void add()}>Add rate</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
