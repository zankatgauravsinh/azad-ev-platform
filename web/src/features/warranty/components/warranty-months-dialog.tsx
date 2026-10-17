import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { WARRANTY_EXTRAS_MAX, WARRANTY_MONTH_COMPONENTS, WARRANTY_MONTHS_MAX, reviseWarrantyMonthsSchema, type WarrantyCoverageLine, type WarrantyMonthComponent } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { saveBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { warrantyApi } from '../api';
import { useWarrantyMutations } from '../hooks';

const LABELS: Record<WarrantyMonthComponent, string> = { MOTOR: 'Motor', BATTERY: 'Battery', CONTROLLER: 'Controller', CHARGER: 'Charger' };

/** A component's months as the card shows them: its own months, 0 when not covered, else the overall period. */
function monthsOn(coverage: WarrantyCoverageLine[], item: WarrantyMonthComponent, periodMonths: number): string {
  const line = coverage.find((c) => c.item === item);
  if (!line) return String(periodMonths);
  if (!line.covered) return '0';
  return String(line.months ?? periodMonths);
}

/** The card's extra items (its covered custom lines), as editable rows. */
const extrasOn = (coverage: WarrantyCoverageLine[]): { name: string; months: string }[] =>
  coverage.filter((c) => c.item === 'CUSTOM' && c.covered && c.months).map((c) => ({ name: c.label, months: String(c.months) }));

/**
 * Owner only: change the motor / battery / controller / charger warranty months and the extra items (+ adds one). The card is regenerated under
 * the same warranty number and start date (the delivery date), and the new card is downloaded.
 */
export function WarrantyMonthsDialog({
  open,
  onOpenChange,
  warranty,
  coverage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warranty: { id: string; warrantyNumber: string; periodMonths: number };
  coverage: WarrantyCoverageLine[];
}): JSX.Element {
  const { reviseMonths } = useWarrantyMutations();
  const [values, setValues] = useState<Record<WarrantyMonthComponent, string>>({ MOTOR: '', BATTERY: '', CONTROLLER: '', CHARGER: '' });
  const [extras, setExtras] = useState<{ name: string; months: string }[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(WARRANTY_MONTH_COMPONENTS.map((c) => [c, monthsOn(coverage, c, warranty.periodMonths)])) as Record<WarrantyMonthComponent, string>);
    setExtras(extrasOn(coverage));
    setReason('');
    setError(null);
  }, [open, coverage, warranty.periodMonths]);

  const save = async (): Promise<void> => {
    const parsed = reviseWarrantyMonthsSchema.safeParse({ months: values, extras, reason: reason.trim() || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the months');
      return;
    }
    setError(null);
    try {
      await reviseMonths.mutateAsync({ id: warranty.id, body: parsed.data });
      toast.success('Warranty months updated — card regenerated');
      onOpenChange(false);
      try {
        saveBlob(await warrantyApi.certificate(warranty.id), `warranty-${warranty.warrantyNumber}.pdf`);
      } catch {
        // The change is saved; the card can still be downloaded from the warranty.
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not update the warranty'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit warranty</DialogTitle>
          <DialogDescription>
            {warranty.warrantyNumber} — the card is regenerated under the same number, still starting on the delivery date. 0 = not covered.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {WARRANTY_MONTH_COMPONENTS.map((c) => (
            <div key={c} className="space-y-1.5">
              <Label htmlFor={`wm-${c}`}>{LABELS[c]} (months)</Label>
              <Input
                id={`wm-${c}`}
                type="number"
                min={0}
                max={WARRANTY_MONTHS_MAX}
                step={1}
                inputMode="numeric"
                value={values[c]}
                onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Extra items</p>
          {extras.length === 0 && <p className="text-xs text-muted-foreground">None — use + to add your own item to the card.</p>}
          {extras.map((item, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Extra item ${i + 1} name`} placeholder="Item name" maxLength={60} className="flex-1" value={item.name} onChange={(e) => setExtras((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={`Extra item ${i + 1} months`} type="number" min={1} max={WARRANTY_MONTHS_MAX} step={1} inputMode="numeric" placeholder="Months" className="w-24" value={item.months} onChange={(e) => setExtras((list) => list.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)))} />
              <Button type="button" variant="outline" size="icon" aria-label={`Remove extra item ${i + 1}`} onClick={() => setExtras((list) => list.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {extras.length < WARRANTY_EXTRAS_MAX && (
            <Button type="button" variant="outline" size="sm" onClick={() => setExtras((list) => [...list, { name: '', months: '12' }])}>
              <Plus className="h-4 w-4" /> Add warranty item
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wm-reason">Reason (optional)</Label>
          <Input id="wm-reason" maxLength={300} placeholder="e.g. Manufacturer extended battery cover" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={reviseMonths.isPending}>{reviseMonths.isPending ? 'Saving…' : 'Save & regenerate'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
