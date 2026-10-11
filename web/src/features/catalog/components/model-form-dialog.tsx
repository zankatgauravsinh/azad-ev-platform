import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { createCatalogModelSchema, type CatalogModelDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCatalogMutations } from '../hooks';

// The shared create schema is the validation; description is a plain string in the form.
const formSchema = createCatalogModelSchema.extend({ description: z.string().trim().max(500) });
type FormValues = z.infer<typeof formSchema>;
const empty: FormValues = { brand: '', name: '', description: '' };

/** Create or edit a model: brand, name, description. GST classification and activation have their own places. */
export function ModelFormDialog({ open, onOpenChange, model }: { open: boolean; onOpenChange: (o: boolean) => void; model?: CatalogModelDto }): JSX.Element {
  const isEdit = Boolean(model);
  // Once a vehicle of this model is committed, its brand and name are locked by the server (M4B.5).
  const identityLocked = Boolean(model?.identityLocked);
  const { createModel, updateModel } = useCatalogMutations();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: empty });
  useEffect(() => { if (open) reset(model ? { brand: model.brand, name: model.name, description: model.description ?? '' } : empty); }, [open, model, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const payload = { brand: v.brand, name: v.name, description: v.description || undefined };
    try {
      if (isEdit && model) {
        // A locked model never sends its brand / name (they cannot change).
        await updateModel.mutateAsync({ id: model.id, input: identityLocked ? { description: payload.description } : payload });
        toast.success('Model updated');
      } else {
        await createModel.mutateAsync(payload);
        toast.success('Model added');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the model'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit model' : 'Add model'}</DialogTitle>
          <DialogDescription>
            {!isEdit
              ? 'A model groups the variants (trim and colour) you stock.'
              : identityLocked
                ? 'Only the description can change.'
                : 'No vehicle of this model is booked or sold yet, so its brand and name can still change.'}
          </DialogDescription>
        </DialogHeader>
        {identityLocked && (
          <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Vehicles of this model are booked, delivered or have sale, warranty or AMC history, so its brand and name can't change. Add a new model for future stock instead.
          </p>
        )}
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <div className="space-y-1.5"><Label htmlFor="model-brand">Brand</Label><Input id="model-brand" autoComplete="off" placeholder="e.g. Comptech" readOnly={identityLocked} aria-readonly={identityLocked} className={identityLocked ? 'bg-muted' : undefined} {...register('brand')} />{errors.brand && <p className="text-xs text-destructive">{errors.brand.message}</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="model-name">Model name</Label><Input id="model-name" autoComplete="off" placeholder="e.g. VX1" readOnly={identityLocked} aria-readonly={identityLocked} className={identityLocked ? 'bg-muted' : undefined} {...register('name')} />{errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}</div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="model-description">Description</Label><Textarea id="model-description" rows={2} placeholder="Optional" {...register('description')} />{errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}</div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isEdit ? 'Save changes' : 'Add model'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
