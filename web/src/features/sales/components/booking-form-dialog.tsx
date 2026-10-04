import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { rupeesToPaise, paiseToRupees, formatPaise } from '@/lib/money';
import { useAvailableUnits } from '@/features/inventory/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi, type BookingDto } from '../api';
import { useSalesInvalidate } from '../hooks';
import { CustomerCombobox } from './customer-combobox';
import { PriceFields } from './price-fields';

interface FormValues {
  customerId: string; unitId: string;
  exShowroom: number; discount: number; exchangeValue: number; rto: number; insurance: number; registration: number; extendedWarranty: number;
  advanceAmount: number; financeRequired: boolean; insuranceRequired: boolean; expectedDelivery: string; notes: string;
}
const empty: FormValues = { customerId: '', unitId: '', exShowroom: 0, discount: 0, exchangeValue: 0, rto: 0, insurance: 0, registration: 0, extendedWarranty: 0, advanceAmount: 0, financeRequired: false, insuranceRequired: false, expectedDelivery: '', notes: '' };

const fromBooking = (b: BookingDto): FormValues => ({
  customerId: b.customer.id,
  unitId: b.unit.id,
  exShowroom: paiseToRupees(b.exShowroom),
  discount: paiseToRupees(b.discount),
  exchangeValue: paiseToRupees(b.exchangeValue),
  rto: paiseToRupees(b.rto),
  insurance: paiseToRupees(b.insuranceCharge),
  registration: paiseToRupees(b.registration),
  extendedWarranty: paiseToRupees(b.extendedWarranty),
  advanceAmount: paiseToRupees(b.advanceAmount),
  financeRequired: b.financeRequired,
  insuranceRequired: b.insuranceRequired,
  expectedDelivery: b.expectedDelivery ? b.expectedDelivery.slice(0, 10) : '',
  notes: b.notes ?? '',
});

/**
 * Create a booking, or edit an existing DRAFT/CONFIRMED one. In edit mode the customer and the
 * allocated vehicle are read-only (the backend rejects changing them — a converted/cancelled booking
 * is not editable at all), and only non-financial / pricing fields are sent. Accessories and recorded
 * payments are left untouched by an edit.
 */
export function BookingFormDialog({ open, onOpenChange, booking }: { open: boolean; onOpenChange: (o: boolean) => void; booking?: BookingDto }): JSX.Element {
  const isEdit = Boolean(booking);
  const { data: units } = useAvailableUnits();
  const invalidate = useSalesInvalidate();
  const { control, register, handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = useForm<FormValues>({ defaultValues: empty });
  useEffect(() => { if (open) reset(booking ? fromBooking(booking) : empty); }, [open, booking, reset]);
  const values = watch();

  const onSubmit = handleSubmit(async (v) => {
    try {
      if (isEdit && booking) {
        // Commercial terms (pricing, accessories, advance) are frozen after creation — only
        // non-financial / operational fields are sent. The backend contract rejects anything else.
        await salesApi.updateBooking(booking.id, {
          financeRequired: v.financeRequired,
          insuranceRequired: v.insuranceRequired,
          expectedDelivery: v.expectedDelivery ? new Date(v.expectedDelivery) : undefined,
          notes: v.notes.trim() ? v.notes.trim() : undefined,
        });
        invalidate();
        toast.success('Booking updated');
        onOpenChange(false);
        return;
      }
      if (!v.customerId) { toast.error('Select a customer'); return; }
      if (!v.unitId) { toast.error('Select an available scooter'); return; }
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
        notes: v.notes.trim() ? v.notes.trim() : undefined,
      });
      invalidate();
      toast.success('Booking created & scooter allocated');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, isEdit ? 'Could not update booking' : 'Could not create booking'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit booking ${booking!.code}` : 'New booking'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update pricing, delivery and notes. Customer and vehicle cannot be changed.' : 'Allocates a specific scooter (VIN) to the customer.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {isEdit ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Customer</Label><Input value={booking!.customer.name} disabled readOnly /></div>
              <div className="space-y-1.5"><Label>Scooter</Label><Input value={`${booking!.unit.variant.model.name} ${booking!.unit.variant.name} · ${booking!.unit.vin}`} disabled readOnly /></div>
            </div>
          ) : (
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
          )}

          {/* Pricing / commercial terms are set at creation only and frozen afterwards. */}
          {!isEdit && <PriceFields register={register} values={values} />}
          {isEdit && (
            <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
              On-road total <span className="font-semibold text-foreground tabular-nums">{formatPaise(booking!.total)}</span> — pricing is fixed after booking and can't be edited here.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {!isEdit && <div className="space-y-1.5"><Label>Advance (₹)</Label><Input type="number" min={0} {...register('advanceAmount', { valueAsNumber: true })} /></div>}
            <div className="space-y-1.5"><Label>Expected delivery</Label><Input type="date" {...register('expectedDelivery')} /></div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('financeRequired')} /> Finance</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('insuranceRequired')} /> Insurance</label>
            </div>
          </div>

          <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} {...register('notes')} placeholder="Internal booking notes" /></div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create booking'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
