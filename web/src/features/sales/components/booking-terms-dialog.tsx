import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReviseBookingTermsInput } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { useAvailableUnits } from '@/features/inventory/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi, type BookingDto } from '../api';
import { useSalesInvalidate } from '../hooks';
import { CustomerCombobox } from './customer-combobox';
import { PriceFields, rawOnRoad, type PriceValues } from './price-fields';

interface FormValues extends PriceValues {
  customerId: string;
  unitId: string;
  salesExecutiveId: string;
  reason: string;
}

const PRICE_KEYS: { key: keyof PriceValues; paise: (b: BookingDto) => string }[] = [
  { key: 'exShowroom', paise: (b) => b.exShowroom },
  { key: 'discount', paise: (b) => b.discount },
  { key: 'exchangeValue', paise: (b) => b.exchangeValue },
  { key: 'rto', paise: (b) => b.rto },
  { key: 'insurance', paise: (b) => b.insuranceCharge },
  { key: 'registration', paise: (b) => b.registration },
  { key: 'extendedWarranty', paise: (b) => b.extendedWarranty },
];

const fromBooking = (b: BookingDto): FormValues => ({
  customerId: b.customer.id,
  unitId: b.unit.id,
  salesExecutiveId: b.salesExecutive?.id ?? '',
  reason: '',
  ...(Object.fromEntries(PRICE_KEYS.map((p) => [p.key, paiseToRupees(p.paise(b))])) as unknown as PriceValues),
});

/**
 * Owner (bookings.terms): correct a booking's price / offer, scooter, customer or sales executive before it is
 * invoiced. Only what changed is sent; the server recalculates the total, keeps it at or above what was received,
 * and records old → new with the reason. Once an RTO invoice exists the customer and scooter stay as they are.
 */
export function BookingTermsDialog({ open, onOpenChange, booking }: { open: boolean; onOpenChange: (o: boolean) => void; booking: BookingDto }): JSX.Element {
  const invalidate = useSalesInvalidate();
  const { data: units } = useAvailableUnits();
  const { data: executives } = useQuery({ queryKey: ['sales', 'sales-executives'], queryFn: salesApi.salesExecutives, enabled: open });
  const { control, register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm<FormValues>({ defaultValues: fromBooking(booking) });
  useEffect(() => { if (open) reset(fromBooking(booking)); }, [open, booking, reset]);
  const values = watch();
  const locked = Boolean(booking.rtoInvoice);
  const accessoriesRupees = paiseToRupees(booking.accessoriesTotal);
  const newTotal = rawOnRoad(values, accessoriesRupees);
  const oldTotal = paiseToRupees(booking.total);
  const received = paiseToRupees(booking.paymentSummary.paid);
  const belowReceived = newTotal >= 0 && newTotal < received;

  const onSubmit = handleSubmit(async (v) => {
    const input: ReviseBookingTermsInput = { reason: v.reason.trim() };
    if (v.customerId && v.customerId !== booking.customer.id) input.customerId = v.customerId;
    if (v.unitId && v.unitId !== booking.unit.id) input.unitId = v.unitId;
    if (v.salesExecutiveId && v.salesExecutiveId !== booking.salesExecutive?.id) input.salesExecutiveId = v.salesExecutiveId;
    for (const p of PRICE_KEYS) {
      const next = Number(rupeesToPaise(v[p.key] || 0));
      if (next !== Number(p.paise(booking))) input[p.key] = next;
    }
    if (Object.keys(input).length === 1) { toast.error('Nothing was changed'); return; }
    if (input.reason.length < 3) { toast.error('Say why the booking is being changed'); return; }
    try {
      await salesApi.reviseBookingTerms(booking.id, input);
      invalidate();
      toast.success('Booking terms changed');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not change the booking'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change terms of {booking.code}</DialogTitle>
          <DialogDescription>Correct the price or offer, the scooter, the customer or the sales executive. Possible until the tax invoice is generated; every change is recorded with your reason.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="terms-customer">Customer</Label>
              {locked ? <Input id="terms-customer" value={booking.customer.name} disabled readOnly /> : (
                <Controller control={control} name="customerId" render={({ field }) => <CustomerCombobox id="terms-customer" value={field.value} onChange={(id) => field.onChange(id)} />} />
              )}
            </div>
            <FormField label="Scooter">
              {locked ? <Input value={`${booking.unit.variant.model.name} ${booking.unit.variant.name} · ${booking.unit.vin}`} disabled readOnly /> : (
                <Controller control={control} name="unitId" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Scooter"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={booking.unit.id}><span className="font-mono">{booking.unit.vin}</span> · {booking.unit.variant.model.name} {booking.unit.variant.name} · {booking.unit.variant.colour} (current)</SelectItem>
                      {(units?.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}><span className="font-mono">{u.vin}</span> · {u.variant.model.name} {u.variant.name} · {u.variant.colour}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              )}
            </FormField>
            <FormField label="Sales executive">
              <Controller control={control} name="salesExecutiveId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Sales executive"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {booking.salesExecutive && !executives?.some((e) => e.id === booking.salesExecutive!.id) && <SelectItem value={booking.salesExecutive.id}>{booking.salesExecutive.name}</SelectItem>}
                    {(executives ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
          {locked && <p className="text-xs text-muted-foreground">RTO invoice {booking.rtoInvoice!.invoiceNumber} names this customer and scooter, so they can no longer be changed here.</p>}

          <PriceFields register={register} values={values} accessoriesRupees={accessoriesRupees} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 text-sm">
            <span>Total <span className="tabular-nums text-muted-foreground line-through">{formatPaise(booking.total)}</span> → <span className="font-semibold tabular-nums">{formatPaise(Math.max(newTotal, 0) * 100)}</span>{newTotal !== oldTotal && newTotal >= 0 && <span className="ml-1 text-muted-foreground">({newTotal > oldTotal ? '+' : '−'}{formatPaise(Math.abs(newTotal - oldTotal) * 100)})</span>}</span>
            <span className="text-muted-foreground">Received so far {formatPaise(booking.paymentSummary.paid)}</span>
          </div>
          {belowReceived && <p role="alert" className="text-xs text-destructive">The new total is less than what has already been received.</p>}

          <FormField label="Reason for the change">
            <Textarea rows={2} {...register('reason')} placeholder="e.g. Diwali offer ₹2,000 added · booked under the wrong customer" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || belowReceived || newTotal < 0 || values.reason.trim().length < 3}>{isSubmitting ? 'Saving…' : 'Save changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
