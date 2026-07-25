import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { rupeesToPaise } from '@/lib/money';
import { useVariants } from '@/features/inventory/hooks';
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
  customerId: string;
  variantId: string;
  exShowroom: number; discount: number; exchangeValue: number; rto: number; insurance: number; registration: number; extendedWarranty: number;
  financeDownPayment: number; financeLoanAmount: number; financeTenureMonths: number; financeEmi: number;
  validUntil: string; notes: string;
}
const empty: FormValues = { customerId: '', variantId: '', exShowroom: 0, discount: 0, exchangeValue: 0, rto: 0, insurance: 0, registration: 0, extendedWarranty: 0, financeDownPayment: 0, financeLoanAmount: 0, financeTenureMonths: 0, financeEmi: 0, validUntil: '', notes: '' };

export function QuotationFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { data: variants = [] } = useVariants();
  const invalidate = useSalesInvalidate();
  const { control, register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({ defaultValues: empty });

  useEffect(() => { if (open) reset(empty); }, [open, reset]);
  const values = watch();

  const onSubmit = handleSubmit(async (v) => {
    if (!v.customerId) { toast.error('Select a customer'); return; }
    if (!v.variantId) { toast.error('Select a variant'); return; }
    try {
      await salesApi.createQuotation({
        customerId: v.customerId,
        variantId: v.variantId,
        exShowroom: Number(rupeesToPaise(v.exShowroom)),
        discount: Number(rupeesToPaise(v.discount)),
        exchangeValue: Number(rupeesToPaise(v.exchangeValue)),
        rto: Number(rupeesToPaise(v.rto)),
        insurance: Number(rupeesToPaise(v.insurance)),
        registration: Number(rupeesToPaise(v.registration)),
        extendedWarranty: Number(rupeesToPaise(v.extendedWarranty)),
        accessories: [],
        financeDownPayment: Number(rupeesToPaise(v.financeDownPayment)),
        financeLoanAmount: Number(rupeesToPaise(v.financeLoanAmount)),
        financeTenureMonths: Number(v.financeTenureMonths) || 0,
        financeEmi: Number(rupeesToPaise(v.financeEmi)),
        validUntil: v.validUntil ? new Date(v.validUntil) : undefined,
        notes: v.notes || undefined,
      });
      invalidate();
      toast.success('Quotation created');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not create quotation'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
          <DialogDescription>Estimate the on-road price for a customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Controller control={control} name="customerId" render={({ field }) => (
                <CustomerCombobox value={field.value} onChange={(id) => field.onChange(id)} />
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Scooter (variant)</Label>
              <Controller control={control} name="variantId" render={({ field }) => (
                <Select value={field.value} onValueChange={(val) => {
                  field.onChange(val);
                  const v = variants.find((x) => x.id === val);
                  if (v) setValue('exShowroom', Number(v.exShowroomPrice) / 100);
                }}>
                  <SelectTrigger><SelectValue placeholder="Select variant" /></SelectTrigger>
                  <SelectContent>
                    {variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.model.brand} {v.model.name} {v.name} · {v.colour}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <PriceFields register={register} values={values} />

          <div>
            <p className="mb-2 text-sm font-semibold">Finance estimate (optional)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1.5"><Label>Down (₹)</Label><Input type="number" min={0} {...register('financeDownPayment', { valueAsNumber: true })} /></div>
              <div className="space-y-1.5"><Label>Loan (₹)</Label><Input type="number" min={0} {...register('financeLoanAmount', { valueAsNumber: true })} /></div>
              <div className="space-y-1.5"><Label>EMI (₹)</Label><Input type="number" min={0} {...register('financeEmi', { valueAsNumber: true })} /></div>
              <div className="space-y-1.5"><Label>Tenure (mo)</Label><Input type="number" min={0} {...register('financeTenureMonths', { valueAsNumber: true })} /></div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Valid until</Label><Input type="date" {...register('validUntil')} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Input {...register('notes')} /></div>
          </div>
          {errors.customerId && <p className="text-xs text-destructive">Customer is required</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Create quotation'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
