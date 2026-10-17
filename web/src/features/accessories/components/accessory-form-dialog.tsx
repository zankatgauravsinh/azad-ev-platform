import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { ACCESSORY_NAME_MAX, type AccessoryDto, type UpdateAccessoryInput } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccessoryCategories, useAccessoryMutations } from '../hooks';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(ACCESSORY_NAME_MAX, `At most ${ACCESSORY_NAME_MAX} characters`),
  sku: z.string().trim().max(40, 'At most 40 characters'),
  category: z.string().trim().max(80, 'At most 80 characters'),
  sellPrice: z.coerce.number({ invalid_type_error: 'Enter a price' }).min(0, 'Cannot be negative'),
  minStock: z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Whole numbers only').min(0, 'Cannot be negative').max(100_000),
});
type FormValues = z.infer<typeof formSchema>;

const toValues = (a?: AccessoryDto): FormValues => ({
  name: a?.name ?? '',
  sku: a?.sku ?? '',
  category: a?.category ?? '',
  sellPrice: a ? paiseToRupees(a.sellPrice) : 0,
  minStock: a?.minStock ?? 0,
});

/**
 * Add or edit an accessory's catalogue details. Stock and cost are not here: they come from opening stock,
 * purchases and adjustments.
 */
export function AccessoryFormDialog({ open, onOpenChange, accessory }: { open: boolean; onOpenChange: (open: boolean) => void; accessory?: AccessoryDto }): JSX.Element {
  const isEdit = Boolean(accessory);
  const { create, update } = useAccessoryMutations();
  const { data: categories = [] } = useAccessoryCategories();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: toValues(accessory) });

  useEffect(() => {
    if (open) reset(toValues(accessory));
  }, [open, accessory, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const body = { name: v.name, sku: v.sku || null, category: v.category || null, sellPrice: rupeesToPaise(v.sellPrice), minStock: v.minStock };
    try {
      if (accessory) {
        // Only what changed.
        const before = { name: accessory.name, sku: accessory.sku, category: accessory.category, sellPrice: Number(accessory.sellPrice), minStock: accessory.minStock };
        const changed = Object.fromEntries(Object.entries(body).filter(([k, val]) => (k === 'sku' ? (val as string | null)?.toUpperCase() ?? null : val) !== before[k as keyof typeof before])) as UpdateAccessoryInput;
        if (Object.keys(changed).length === 0) {
          onOpenChange(false);
          return;
        }
        await update.mutateAsync({ id: accessory.id, body: changed });
        toast.success('Accessory updated');
      } else {
        await create.mutateAsync({ ...body, isPart: false });
        toast.success('Accessory added');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the accessory'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit accessory' : 'Add accessory'}</DialogTitle>
          <DialogDescription>Stock and cost are added through opening stock and purchases, not here.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus maxLength={ACCESSORY_NAME_MAX} placeholder="e.g. Helmet (ISI)" {...register('name')} />
          </FormField>
          <FormField label="SKU (optional)" error={errors.sku?.message}>
            <Input className="uppercase" maxLength={40} placeholder="e.g. HEL-01" {...register('sku')} />
          </FormField>
          <FormField label="Category (optional)" error={errors.category?.message}>
            <Input list="accessory-categories" maxLength={80} placeholder="e.g. Safety" {...register('category')} />
          </FormField>
          <datalist id="accessory-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <FormField label="Selling price (₹)" error={errors.sellPrice?.message}>
            <Input type="number" min={0} step="0.01" inputMode="decimal" {...register('sellPrice')} />
          </FormField>
          <FormField label="Low-stock alert at" error={errors.minStock?.message}>
            <Input type="number" min={0} step={1} inputMode="numeric" {...register('minStock')} />
          </FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add accessory'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
