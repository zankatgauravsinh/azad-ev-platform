import { useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWarrantyMutations } from '../hooks';
import { VehiclePicker } from './vehicle-picker';

export function CreateWarrantyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }): JSX.Element {
  const { create } = useWarrantyMutations();
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [periodMonths, setPeriodMonths] = useState('36');
  const [dealerNotes, setDealerNotes] = useState('');

  const reset = (): void => { setSearch(''); setUnitId(''); setUnitLabel(''); setPeriodMonths('36'); setDealerNotes(''); };

  const submit = async (): Promise<void> => {
    if (!unitId) { toast.error('Select a vehicle'); return; }
    try {
      const res = await create.mutateAsync({ unitId, periodMonths: Number(periodMonths) || undefined, dealerNotes: dealerNotes || undefined });
      toast.success(`Warranty ${res.warranty.warrantyNumber} created`);
      reset();
      onOpenChange(false);
      onCreated(res.warranty.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>New warranty</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <VehiclePicker search={search} onSearch={setSearch} value={unitId} onPick={(id, label) => { setUnitId(id); setUnitLabel(label); setSearch(label); }} />
          {unitLabel && <p className="text-sm text-muted-foreground">Selected: {unitLabel}</p>}
          <div className="space-y-1">
            <Label>Warranty period (months)</Label>
            <Input type="number" min={1} value={periodMonths} onChange={(e) => setPeriodMonths(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dealer notes</Label>
            <Textarea rows={2} value={dealerNotes} onChange={(e) => setDealerNotes(e.target.value)} placeholder="Optional" />
          </div>
          <p className="text-xs text-muted-foreground">Standard coverage and three free services are added automatically. The customer is taken from the vehicle&apos;s booking.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>Create warranty</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
