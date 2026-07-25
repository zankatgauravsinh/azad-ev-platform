import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { UNIT_STATUSES, UnitStatus, type CreateUnitInput, type UpdateUnitInput } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { unitStatusLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateUnit, useModels, useUpdateUnit } from '../hooks';
import { inventoryApi } from '../api';
import type { UnitDetail } from '../api';
import { VinScanner } from './vin-scanner';

const formSchema = z.object({
  modelId: z.string().uuid('Select a model'),
  variant: z.string().trim().min(1, 'Variant is required'),
  colour: z.string().trim().min(1, 'Colour is required'),
  hexColour: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Use #RRGGBB')
    .or(z.literal(''))
    .optional(),
  vin: z.string().trim().min(3, 'VIN is required'),
  motorNumber: z.string().trim().min(1, 'Required'),
  batteryNumber: z.string().trim().min(1, 'Required'),
  purchaseDate: z.string().optional(),
  purchaseCost: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  supplier: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]),
});
type FormValues = z.infer<typeof formSchema>;

export function UnitFormDialog({
  open,
  onOpenChange,
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit?: UnitDetail;
}): JSX.Element {
  const isEdit = Boolean(unit);
  const { data: models = [] } = useModels();
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit(unit?.id ?? '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [vinTaken, setVinTaken] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (!open) return;
    reset(unit ? toFormValues(unit) : emptyValues());
    setVinTaken(false);
  }, [open, unit, reset]);

  const vin = watch('vin');
  useEffect(() => {
    const value = vin?.trim().toUpperCase();
    if (!value || value.length < 3 || (isEdit && value === unit?.vin)) {
      setVinTaken(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { exists } = await inventoryApi.checkVin(value);
        setVinTaken(exists);
      } catch {
        setVinTaken(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [vin, isEdit, unit?.vin]);

  const onSubmit = handleSubmit(async (values) => {
    if (vinTaken) {
      toast.error('This VIN already exists');
      return;
    }
    const base = {
      modelId: values.modelId,
      variant: values.variant,
      colour: values.colour,
      hexColour: values.hexColour ? values.hexColour : undefined,
      vin: values.vin.toUpperCase(),
      motorNumber: values.motorNumber.toUpperCase(),
      batteryNumber: values.batteryNumber.toUpperCase(),
      purchaseDate: values.purchaseDate ? new Date(values.purchaseDate) : undefined,
      purchaseCost: Number(rupeesToPaise(values.purchaseCost)),
      sellingPrice: Number(rupeesToPaise(values.sellingPrice)),
      supplier: values.supplier || undefined,
      location: values.location || undefined,
      notes: values.notes || undefined,
    };
    try {
      if (isEdit && unit) {
        await updateUnit.mutateAsync(base as UpdateUnitInput);
        toast.success('Scooter updated');
      } else {
        await createUnit.mutateAsync({ ...base, status: values.status } as CreateUnitInput);
        toast.success('Scooter added');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not save the scooter'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit scooter' : 'Add scooter'}</DialogTitle>
          <DialogDescription>
            {isEdit ? `VIN ${unit?.vin}` : 'Register a new unit in inventory.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Model" error={errors.modelId?.message}>
            <Controller
              control={control}
              name="modelId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.brand} {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Variant" error={errors.variant?.message}>
            <Input placeholder="e.g. Pro" {...register('variant')} />
          </Field>
          <Field label="Colour" error={errors.colour?.message}>
            <Input placeholder="e.g. Teal" {...register('colour')} />
          </Field>
          <Field label="Colour swatch (optional)" error={errors.hexColour?.message}>
            <Input placeholder="#00B8A9" {...register('hexColour')} />
          </Field>

          <Field label="VIN" error={errors.vin?.message ?? (vinTaken ? 'This VIN already exists' : undefined)}>
            <div className="flex gap-2">
              <Input className="uppercase" placeholder="Chassis / VIN" {...register('vin')} />
              <Button type="button" variant="outline" size="icon" onClick={() => setScannerOpen(true)}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
          </Field>
          <Field label="Motor number" error={errors.motorNumber?.message}>
            <Input className="uppercase" {...register('motorNumber')} />
          </Field>
          <Field label="Battery number" error={errors.batteryNumber?.message}>
            <Input className="uppercase" {...register('batteryNumber')} />
          </Field>
          <Field label="Purchase date">
            <Input type="date" {...register('purchaseDate')} />
          </Field>

          <Field label="Purchase cost (₹)" error={errors.purchaseCost?.message}>
            <Input type="number" min={0} step={1} {...register('purchaseCost')} />
          </Field>
          <Field label="Selling price (₹)" error={errors.sellingPrice?.message}>
            <Input type="number" min={0} step={1} {...register('sellingPrice')} />
          </Field>
          <Field label="Supplier">
            <Input {...register('supplier')} />
          </Field>
          <Field label="Location">
            <Input placeholder="e.g. Showroom floor" {...register('location')} />
          </Field>

          {!isEdit && (
            <Field label="Initial status">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {unitStatusLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || vinTaken}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add scooter'}
            </Button>
          </DialogFooter>
        </form>

        <VinScanner
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onDetected={(value) => setValue('vin', value, { shouldValidate: true })}
        />
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function emptyValues(): FormValues {
  return {
    modelId: '',
    variant: '',
    colour: '',
    hexColour: '',
    vin: '',
    motorNumber: '',
    batteryNumber: '',
    purchaseDate: '',
    purchaseCost: 0,
    sellingPrice: 0,
    supplier: '',
    location: '',
    notes: '',
    status: UnitStatus.AVAILABLE,
  };
}

function toFormValues(unit: UnitDetail): FormValues {
  return {
    modelId: unit.variant.model.id,
    variant: unit.variant.name,
    colour: unit.variant.colour,
    hexColour: unit.variant.hexColour ?? '',
    vin: unit.vin,
    motorNumber: unit.motorNumber,
    batteryNumber: unit.batteryNumber,
    purchaseDate: unit.purchaseDate ? unit.purchaseDate.slice(0, 10) : '',
    purchaseCost: paiseToRupees(unit.purchaseCost),
    sellingPrice: paiseToRupees(unit.sellingPrice),
    supplier: unit.supplier ?? '',
    location: unit.location ?? '',
    notes: unit.notes ?? '',
    status: unit.status,
  };
}
