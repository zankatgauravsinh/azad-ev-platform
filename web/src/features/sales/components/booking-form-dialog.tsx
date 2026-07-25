import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { CustomerCombobox } from './customer-combobox';
import { PriceFields } from './price-fields';

interface FormValues {
  customerId: string; unitId: string;
  exShowroom: number; discount: number; exchangeValue: number; rto: number; insurance: number; registration: number; extendedWarranty: number;
  advanceAmount: number; financeRequired: boolean; insuranceRequired: boolean; expectedDelivery: string;
}
const empty: FormValues = { customerId: '', unitId: '', exShowroom: 0, discount: 0, exchangeValue: 0, rto: 0, insurance: 0, registration: 0, extendedWarranty: 0, advanceAmount: 0, financeRequired: false, insuranceRequired: false, expectedDelivery: '' };

export function BookingFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { data: units } = useAvailableUnits();
  const invalidate = useSalesInvalidate();
  const { control, register, handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = useForm<FormValues>({ defaultValues: empty });
  useEffect(() => { if (open) reset(empty); }, [open, reset]);
  const values = watch();

  const onSubmit = handleSubmit(async (v) => {
    if (!v.customerId) { toast.error('Select a customer'); return; }
    if (!v.unitId) { toast.error('Select an available scooter'); return; }
    try {
      await salesApi.createBooking({
        customerId: v.customerId,
        unitId: v.unitId,
        exShowroom: Number(rupeesToPaise(v.exShowroom)),
        discount: Number(rupeesToPaise(v.discount)),
        exchangeValue: Number(rupeesToPaise(v.exchangeValue)),
        rto: Number(rupeesToPaise(v.rto)),
        insurance: Number(rupeesToPaise(v.insurance)),
        registration: Number(rupeesToPaise(v.registration)),
        extendedWarranty: Number(rupeesToPaise(v.extendedWarranty)),
        accessories: [],
        advanceAmount: Number(rupeesToPaise(v.advanceAmount)),
        financeRequired: v.financeRequired,
        insuranceRequired: v.insuranceRequired,
        expectedDelivery: v.expectedDelivery ? new Date(v.expectedDelivery) : undefined,
      });
      invalidate();
      toast.success('Booking created & scooter allocated');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not create booking'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>Allocates a specific scooter (VIN) to the customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Controller control={control} name="customerId" render={({ field }) => <CustomerCombobox value={field.value} onChange={(id) => field.onChange(id)} />} />
            </div>
            <div className="space-y-1.5">
              <Label>Scooter (available VIN)</Label>
              <Controller control={control} name="unitId" render={({ field }) => (
                <Select value={field.value} onValueChange={(val) => {
                  field.onChange(val);
                  const u = units?.data.find((x) => x.id === val);
                  if (u) setValue('exShowroom', Number(u.sellingPrice) / 100);
                }}>
                  <SelectTrigger><SelectValue placeholder="Select scooter" /></SelectTrigger>
                  <SelectContent>
                    {(units?.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.variant.model.name} {u.variant.name} · {u.variant.colour} · {u.vin}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <PriceFields register={register} values={values} />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Advance (₹)</Label><Input type="number" min={0} {...register('advanceAmount', { valueAsNumber: true })} /></div>
            <div className="space-y-1.5"><Label>Expected delivery</Label><Input type="date" {...register('expectedDelivery')} /></div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('financeRequired')} /> Finance</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('insuranceRequired')} /> Insurance</label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Create booking'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
