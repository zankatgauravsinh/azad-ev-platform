import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '@/features/inventory/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/form-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi, type QuotationDto } from '../api';
import { useSalesInvalidate } from '../hooks';

/**
 * The booking carries the quotation's price, so only an available scooter of the quoted variant may be
 * allocated (the API enforces the same rule). Units are fetched per model and narrowed to the variant.
 */
export function ConvertQuotationDialog({ open, onOpenChange, quotation }: { open: boolean; onOpenChange: (o: boolean) => void; quotation: Pick<QuotationDto, 'id' | 'code' | 'variant' | 'total'> }): JSX.Element {
  const { variant } = quotation;
  const { data: modelUnits, isLoading } = useQuery({
    queryKey: ['inventory', 'available-units', 'model', variant.model.id],
    queryFn: () => inventoryApi.list({ status: 'AVAILABLE', modelId: variant.model.id, pageSize: 100 }),
    enabled: open,
  });
  const units = (modelUnits?.data ?? []).filter((u) => u.variant.id === variant.id);
  const quoted = `${variant.model.name} ${variant.name} · ${variant.colour}`;
  const invalidate = useSalesInvalidate();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [advance, setAdvance] = useState(0);
  const [busy, setBusy] = useState(false);
  const advanceTooHigh = rupeesToPaise(advance) > Number(quotation.total);

  const submit = async (): Promise<void> => {
    if (!unitId) { toast.error('Select an available scooter'); return; }
    setBusy(true);
    try {
      const booking = await salesApi.convertQuotation(quotation.id, { unitId, advanceAmount: Number(rupeesToPaise(advance)) });
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
          <DialogDescription>Allocate an available {quoted} and carry the pricing of {quotation.code}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={<>Available {quoted} (VIN)</>}>
            <Select value={unitId} onValueChange={setUnitId} disabled={!isLoading && units.length === 0}>
              <SelectTrigger><SelectValue placeholder={isLoading ? 'Loading…' : units.length === 0 ? 'None in stock' : 'Select scooter'} /></SelectTrigger>
              <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.vin}</SelectItem>)}</SelectContent>
            </Select>
            {!isLoading && units.length === 0 && <p className="text-xs text-muted-foreground">No {quoted} is available. Add stock, or create a new quotation for a variant that is in stock.</p>}
          </FormField>
          <FormField label="Advance (₹)">
            <Input type="number" min={0} max={paiseToRupees(quotation.total)} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} aria-invalid={advanceTooHigh} />
            {advanceTooHigh && <p className="text-xs text-destructive">Cannot exceed the on-road total of {formatPaise(quotation.total)}</p>}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !unitId || advanceTooHigh}>{busy ? 'Converting…' : 'Convert'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
