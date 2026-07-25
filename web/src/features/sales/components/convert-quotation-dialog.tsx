import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { rupeesToPaise } from '@/lib/money';
import { useAvailableUnits } from '@/features/inventory/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi } from '../api';
import { useSalesInvalidate } from '../hooks';

export function ConvertQuotationDialog({ open, onOpenChange, quotationId }: { open: boolean; onOpenChange: (o: boolean) => void; quotationId: string }): JSX.Element {
  const { data: units } = useAvailableUnits();
  const invalidate = useSalesInvalidate();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [advance, setAdvance] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!unitId) { toast.error('Select an available scooter'); return; }
    setBusy(true);
    try {
      const booking = await salesApi.convertQuotation(quotationId, { unitId, advanceAmount: Number(rupeesToPaise(advance)) });
      invalidate();
      toast.success(`Booking ${booking.code} created`);
      onOpenChange(false);
      navigate(`/bookings/${booking.id}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not convert'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to booking</DialogTitle>
          <DialogDescription>Allocate a specific scooter and carry the quotation pricing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Available scooter (VIN)</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Select scooter" /></SelectTrigger>
              <SelectContent>{(units?.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.variant.model.name} {u.variant.name} · {u.variant.colour} · {u.vin}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Advance (₹)</Label><Input type="number" min={0} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !unitId}>{busy ? 'Converting…' : 'Convert'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
