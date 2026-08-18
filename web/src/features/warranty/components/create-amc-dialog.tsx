import { useState } from 'react';
import { toast } from 'sonner';
import { AMC_PLAN_TYPES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWarrantyMutations } from '../hooks';
import { VehiclePicker } from './vehicle-picker';

export function CreateAmcDialog({ open, onOpenChange, onCreated, presetUnitId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void; presetUnitId?: string }): JSX.Element {
  const { createAmc } = useWarrantyMutations();
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState(presetUnitId ?? '');
  const [planType, setPlanType] = useState('SILVER');
  const [months, setMonths] = useState('12');
  const [visits, setVisits] = useState('3');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');

  const reset = (): void => { setSearch(''); setUnitId(presetUnitId ?? ''); setPlanType('SILVER'); setMonths('12'); setVisits('3'); setPrice(''); setNotes(''); };

  const submit = async (): Promise<void> => {
    if (!unitId) { toast.error('Select a vehicle'); return; }
    const rupees = Number(price);
    if (!Number.isFinite(rupees) || rupees < 0) { toast.error('Enter a valid price'); return; }
    try {
      const res = await createAmc.mutateAsync({
        unitId,
        planType: planType as never,
        months: Number(months) || 12,
        visitsIncluded: Number(visits) || 3,
        price: Math.round(rupees * 100),
        notes: notes || undefined,
      });
      toast.success(`AMC ${res.amcNumber} created`);
      reset();
      onOpenChange(false);
      onCreated(res.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>New AMC plan</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!presetUnitId && <VehiclePicker search={search} onSearch={setSearch} value={unitId} onPick={(id, label) => { setUnitId(id); setSearch(label); }} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Plan</Label>
              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AMC_PLAN_TYPES.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Duration (months)</Label><Input type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} /></div>
            <div className="space-y-1"><Label>Visits included</Label><Input type="number" min={1} value={visits} onChange={(e) => setVisits(e.target.value)} /></div>
            <div className="space-y-1"><Label>Price (₹)</Label><Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 2999" /></div>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createAmc.isPending}>Create AMC</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
