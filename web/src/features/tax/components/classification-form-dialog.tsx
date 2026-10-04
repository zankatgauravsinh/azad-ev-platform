import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TAX_CODE_TYPES, TAX_TREATMENTS, TaxTreatment, type TaxClassificationDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTaxMutations } from '../hooks';

interface FormValues {
  name: string;
  codeType: (typeof TAX_CODE_TYPES)[number];
  code: string;
  treatment: (typeof TAX_TREATMENTS)[number];
  description: string;
  isActive: boolean;
}
const empty: FormValues = { name: '', codeType: 'HSN', code: '', treatment: TaxTreatment.TAXABLE, description: '', isActive: true };
const fromDto = (c: TaxClassificationDto): FormValues => ({
  name: c.name, codeType: c.codeType, code: c.code ?? '', treatment: c.treatment, description: c.description ?? '', isActive: c.isActive,
});

export function ClassificationFormDialog({
  open,
  onOpenChange,
  classification,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classification?: TaxClassificationDto;
}): JSX.Element {
  const isEdit = Boolean(classification);
  const { createClassification, updateClassification } = useTaxMutations();
  const { control, register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm<FormValues>({ defaultValues: empty });
  useEffect(() => { if (open) reset(classification ? fromDto(classification) : empty); }, [open, classification, reset]);
  const treatment = watch('treatment');

  const onSubmit = handleSubmit(async (v) => {
    if (!v.name.trim()) { toast.error('Name is required'); return; }
    if (v.treatment === TaxTreatment.TAXABLE && !v.code.trim()) { toast.error('A taxable classification needs an HSN/SAC code'); return; }
    const payload = {
      name: v.name.trim(),
      codeType: v.codeType,
      code: v.code.trim() ? v.code.trim() : null,
      treatment: v.treatment,
      description: v.description.trim() ? v.description.trim() : null,
      isActive: v.isActive,
    };
    try {
      if (isEdit && classification) {
        await updateClassification.mutateAsync({ id: classification.id, input: payload });
        toast.success('Classification updated');
      } else {
        await createClassification.mutateAsync(payload);
        toast.success('Classification created');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the classification'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit tax classification' : 'New tax classification'}</DialogTitle>
          <DialogDescription>Configuration only — this does not calculate tax on any existing sale.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <div className="space-y-1.5 sm:col-span-2"><Label>Name</Label><Input autoComplete="off" {...register('name')} placeholder="e.g. Electric two-wheeler" /></div>
          <div className="space-y-1.5">
            <Label>Code type</Label>
            <Controller control={control} name="codeType" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TAX_CODE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </div>
          <div className="space-y-1.5"><Label>HSN / SAC code</Label><Input autoComplete="off" {...register('code')} placeholder={treatment === TaxTreatment.TAXABLE ? 'Required' : 'Optional'} /></div>
          <div className="space-y-1.5">
            <Label>Treatment</Label>
            <Controller control={control} name="treatment" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TAX_TREATMENTS.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('isActive')} /> Active</label></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Description (optional)</Label><Textarea rows={2} {...register('description')} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
