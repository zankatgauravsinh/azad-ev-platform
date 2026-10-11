import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Lock, Plus, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { UNIT_STATUSES, UnitStatus, type CreateUnitInput, type UpdateUnitInput } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { VariantFormDialog } from '@/features/catalog/components/variant-form-dialog';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, paiseToRupees, rupeesToPaise } from '@/lib/money';
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
import { useCreateUnit, useModels, useUpdateUnit, useVariants } from '../hooks';
import { inventoryApi } from '../api';
import type { ModelRef, UnitDetail, VariantOption } from '../api';
import { VinScanner } from './vin-scanner';

/** Blank → '' (the field is left out of the request); otherwise whole rupees, never negative. */
const optionalRupees = z.union([z.literal(''), z.coerce.number().min(0, 'Cannot be negative')]);

const formSchema = z.object({
  modelId: z.string().uuid('Select a model'),
  variantId: z.string().uuid('Select a variant'),
  vin: z.string().trim().min(3, 'VIN is required'),
  motorNumber: z.string().trim().min(1, 'Required'),
  batteryNumber: z.string().trim().min(1, 'Required'),
  purchaseDate: z.string().optional(),
  purchaseCost: z.coerce.number().min(0),
  sellingPrice: optionalRupees,
  supplier: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]),
});
type FormValues = z.infer<typeof formSchema>;

const normalise = (value: string): string => value.trim().toUpperCase();

/**
 * Add / edit a scooter. The vehicle's catalogue identity is always a curated variant (model → variant,
 * the colour comes with the variant); nothing is created from free text. Which identity fields an edit
 * may change comes from the server's `unit.identity` policy — the server re-checks every change.
 */
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
  const { can } = useAuth();
  const canCreateVariant = can('inventory.create');
  const { data: activeModels = [] } = useModels();
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit(unit?.id ?? '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [vinTaken, setVinTaken] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);

  // Locks for an edit (an add is always fully editable).
  const catalogueLocked = isEdit && !unit?.identity?.catalogueEditable;
  const identificationLocked = isEdit && !unit?.identity?.identificationEditable;

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

  const modelId = watch('modelId');
  const variantId = watch('variantId');
  const modelIsActive = activeModels.some((m) => m.id === modelId);
  // Only an active model's variants can be chosen (the server refuses a variant of an inactive model).
  const { data: activeVariants = [] } = useVariants(modelId || undefined, Boolean(modelId) && modelIsActive);

  // The unit's current model / variant stay selectable on edit even when inactive in the catalogue.
  const models: ModelRef[] = useMemo(() => {
    const current = unit?.variant.model;
    return current && !activeModels.some((m) => m.id === current.id) ? [...activeModels, current] : activeModels;
  }, [activeModels, unit]);
  const variants: VariantOption[] = useMemo(() => {
    const current = unit?.variant;
    const currentOption = current && current.model.id === modelId
      ? [{ id: current.id, name: current.name, colour: current.colour, hexColour: current.hexColour ?? null, exShowroomPrice: '0', model: current.model }]
      : [];
    // An inactive model offers nothing but the unit's current variant: no alternative under that model.
    if (!modelIsActive) return currentOption;
    if (currentOption.length === 0 || activeVariants.some((v) => v.id === current!.id)) return activeVariants;
    return [...activeVariants, ...currentOption];
  }, [activeVariants, unit, modelId, modelIsActive]);
  const selectedModel = models.find((m) => m.id === modelId);
  const selectedVariant = variants.find((v) => v.id === variantId);

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
    // Fields that are not part of the vehicle's identity — sent as before.
    const details = {
      purchaseDate: values.purchaseDate ? new Date(values.purchaseDate) : undefined,
      purchaseCost: Number(rupeesToPaise(values.purchaseCost)),
      // Blank selling price: left out (a new unit then takes the variant's list price; an edit keeps its price).
      ...(values.sellingPrice === '' ? {} : { sellingPrice: Number(rupeesToPaise(values.sellingPrice)) }),
      supplier: values.supplier || undefined,
      location: values.location || undefined,
      notes: values.notes || undefined,
    };
    try {
      if (isEdit && unit) {
        // Only identity fields that actually change, and only those the policy allows.
        const identity: UpdateUnitInput = {};
        if (!catalogueLocked && values.variantId !== unit.variant.id) identity.variantId = values.variantId;
        if (!identificationLocked) {
          for (const field of ['vin', 'motorNumber', 'batteryNumber'] as const) {
            if (normalise(values[field]) !== unit[field]) identity[field] = normalise(values[field]);
          }
        }
        await updateUnit.mutateAsync({ ...details, ...identity });
        toast.success('Scooter updated');
      } else {
        const input: CreateUnitInput = {
          ...details,
          variantId: values.variantId,
          vin: normalise(values.vin),
          motorNumber: normalise(values.motorNumber),
          batteryNumber: normalise(values.batteryNumber),
          status: values.status,
        } as CreateUnitInput;
        await createUnit.mutateAsync(input);
        toast.success('Scooter added');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not save the scooter'));
    }
  });

  const lockNotice = isEdit && unit && (catalogueLocked || identificationLocked) ? lockMessage(unit) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit scooter' : 'Add scooter'}</DialogTitle>
          <DialogDescription>
            {isEdit ? `VIN ${unit?.vin}` : 'Register a new unit in inventory.'}
          </DialogDescription>
        </DialogHeader>

        {lockNotice && (
          <p role="note" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{lockNotice}</span>
          </p>
        )}

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Model" htmlFor="unit-model" error={errors.modelId?.message}>
            <Controller
              control={control}
              name="modelId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  disabled={catalogueLocked}
                  onValueChange={(value) => {
                    field.onChange(value);
                    setValue('variantId', ''); // a variant belongs to one model
                  }}
                >
                  <SelectTrigger id="unit-model" aria-label="Model">
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
          <Field label="Variant" htmlFor="unit-variant" error={errors.variantId?.message}>
            <div className="flex gap-2">
              <Controller
                control={control}
                name="variantId"
                render={({ field }) => (
                  <Select value={field.value} disabled={catalogueLocked || !modelId} onValueChange={field.onChange}>
                    <SelectTrigger id="unit-variant" aria-label="Variant">
                      <SelectValue placeholder={modelId ? 'Select variant' : 'Select a model first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="inline-flex items-center gap-2">
                            {v.hexColour && <span aria-hidden className="h-3 w-3 rounded-full border" style={{ backgroundColor: v.hexColour }} />}
                            {v.name} · {v.colour}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {canCreateVariant && !catalogueLocked && modelIsActive && (
                <Button type="button" variant="outline" size="icon" aria-label="Add variant" title="Add a variant to this model" onClick={() => setAddVariantOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Field>
          <Field label="Colour" htmlFor="unit-colour">
            <div className="flex items-center gap-2">
              <Input id="unit-colour" readOnly aria-readonly className="bg-muted" value={selectedVariant?.colour ?? ''} placeholder="Comes with the variant" />
              {selectedVariant?.hexColour && <span aria-hidden className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: selectedVariant.hexColour }} />}
            </div>
          </Field>
          <div className="hidden sm:block" />

          <Field label="VIN" htmlFor="unit-vin" error={errors.vin?.message ?? (vinTaken ? 'This VIN already exists' : undefined)}>
            <div className="flex gap-2">
              <Input id="unit-vin" className={`uppercase ${identificationLocked ? 'bg-muted' : ''}`} placeholder="Chassis / VIN" readOnly={identificationLocked} aria-readonly={identificationLocked} {...register('vin')} />
              <Button type="button" variant="outline" size="icon" aria-label="Scan VIN" disabled={identificationLocked} onClick={() => setScannerOpen(true)}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
          </Field>
          <Field label="Motor number" htmlFor="unit-motor" error={errors.motorNumber?.message}>
            <Input id="unit-motor" className={`uppercase ${identificationLocked ? 'bg-muted' : ''}`} readOnly={identificationLocked} aria-readonly={identificationLocked} {...register('motorNumber')} />
          </Field>
          <Field label="Battery number" htmlFor="unit-battery" error={errors.batteryNumber?.message}>
            <Input id="unit-battery" className={`uppercase ${identificationLocked ? 'bg-muted' : ''}`} readOnly={identificationLocked} aria-readonly={identificationLocked} {...register('batteryNumber')} />
          </Field>
          <Field label="Purchase date" htmlFor="unit-purchase-date">
            <Input id="unit-purchase-date" type="date" {...register('purchaseDate')} />
          </Field>

          <Field label="Purchase cost (₹)" htmlFor="unit-purchase-cost" error={errors.purchaseCost?.message}>
            <Input id="unit-purchase-cost" type="number" min={0} step={1} {...register('purchaseCost')} />
          </Field>
          <Field label="Selling price (₹)" htmlFor="unit-selling-price" error={errors.sellingPrice?.message}>
            <Input
              id="unit-selling-price"
              type="number"
              min={0}
              step={1}
              placeholder={!isEdit && selectedVariant ? `List price ${formatPaise(selectedVariant.exShowroomPrice)}` : undefined}
              {...register('sellingPrice')}
            />
            {!isEdit && <p className="text-xs text-muted-foreground">Leave blank to use the variant&apos;s list price.</p>}
          </Field>
          <Field label="Supplier" htmlFor="unit-supplier">
            <Input id="unit-supplier" {...register('supplier')} />
          </Field>
          <Field label="Location" htmlFor="unit-location">
            <Input id="unit-location" placeholder="e.g. Showroom floor" {...register('location')} />
          </Field>

          {!isEdit && (
            <Field label="Initial status" htmlFor="unit-status">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="unit-status">
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
          <Field label="Notes" htmlFor="unit-notes" className="sm:col-span-2">
            <Textarea id="unit-notes" rows={2} {...register('notes')} />
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
        {addVariantOpen && selectedModel && (
          <VariantFormDialog
            open
            onOpenChange={setAddVariantOpen}
            modelId={selectedModel.id}
            modelLabel={`${selectedModel.brand} ${selectedModel.name}`}
            onSaved={(saved) => setValue('variantId', saved.id, { shouldValidate: true })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Why some identity fields cannot change, from the server's policy. */
function lockMessage(unit: UnitDetail): string {
  const { identity } = unit;
  const correction = identity.correctionEligible
    ? ' An owner can fix a wrong VIN, motor or battery number with "Correct identification" on the vehicle page.'
    : '';
  if (identity.committed) {
    return `This vehicle has a sale, warranty or AMC history, so its model, variant and identification numbers can't be changed here.${correction}`;
  }
  if (identity.identificationEditable) {
    return 'This vehicle is booked, so its model and variant can\'t change. Its VIN, motor and battery numbers can still be corrected before delivery.';
  }
  return `This vehicle has been delivered, is in service or was returned, so its model, variant and identification numbers can't be changed here.${correction}`;
}

function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function emptyValues(): FormValues {
  return {
    modelId: '',
    variantId: '',
    vin: '',
    motorNumber: '',
    batteryNumber: '',
    purchaseDate: '',
    purchaseCost: 0,
    sellingPrice: '',
    supplier: '',
    location: '',
    notes: '',
    status: UnitStatus.AVAILABLE,
  };
}

function toFormValues(unit: UnitDetail): FormValues {
  return {
    modelId: unit.variant.model.id,
    variantId: unit.variant.id,
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
