import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { HEX_COLOUR_PATTERN, type CatalogVariantDto, type CreateCatalogVariantInput } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCatalogMutations } from '../hooks';

// Form values are strings/rupees; the shared schema validates the paise payload built from them.
const optionalInt = z.union([z.literal(''), z.coerce.number().int().min(0)]);
const formSchema = z.object({
  name: z.string().trim().min(1, 'Variant name is required').max(80),
  colour: z.string().trim().min(1, 'Colour is required').max(60),
  hexColour: z.string().trim().refine((v) => v === '' || HEX_COLOUR_PATTERN.test(v), 'Use a #RRGGBB hex colour'),
  priceRupees: z.coerce.number().min(0, 'Price cannot be negative'),
  batteryType: z.string().trim().max(80),
  batteryCapacity: z.string().trim().max(80),
  rangeKm: optionalInt,
  topSpeedKmph: optionalInt,
  chargingTimeHrs: z.union([z.literal(''), z.coerce.number().min(0).max(999.99)]),
  motorPowerW: optionalInt,
  warrantyMonths: optionalInt,
});
type FormValues = z.infer<typeof formSchema>;
const empty: FormValues = { name: '', colour: '', hexColour: '', priceRupees: 0, batteryType: '', batteryCapacity: '', rangeKm: '', topSpeedKmph: '', chargingTimeHrs: '', motorPowerW: '', warrantyMonths: '' };
const fromDto = (v: CatalogVariantDto): FormValues => ({
  name: v.name, colour: v.colour, hexColour: v.hexColour ?? '', priceRupees: paiseToRupees(v.exShowroomPrice),
  batteryType: v.batteryType ?? '', batteryCapacity: v.batteryCapacity ?? '',
  rangeKm: v.rangeKm ?? '', topSpeedKmph: v.topSpeedKmph ?? '', chargingTimeHrs: v.chargingTimeHrs === null ? '' : Number(v.chargingTimeHrs), motorPowerW: v.motorPowerW ?? '', warrantyMonths: v.warrantyMonths ?? '',
});
const num = (v: number | ''): number | undefined => (v === '' ? undefined : v);

/** Builds the API payload. The model is never part of it: a variant is created under a model and cannot move. */
export function toVariantPayload(v: FormValues): CreateCatalogVariantInput {
  return {
    name: v.name, colour: v.colour, hexColour: v.hexColour || undefined,
    exShowroomPrice: rupeesToPaise(v.priceRupees),
    batteryType: v.batteryType || undefined, batteryCapacity: v.batteryCapacity || undefined,
    rangeKm: num(v.rangeKm), topSpeedKmph: num(v.topSpeedKmph), chargingTimeHrs: num(v.chargingTimeHrs), motorPowerW: num(v.motorPowerW), warrantyMonths: num(v.warrantyMonths),
  };
}

export function VariantFormDialog({ open, onOpenChange, modelId, modelLabel, variant, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  modelId: string;
  modelLabel: string;
  variant?: CatalogVariantDto;
  /** Called with the saved variant (e.g. so the Add Scooter form can select a variant it just created). */
  onSaved?: (saved: CatalogVariantDto) => void;
}): JSX.Element {
  const isEdit = Boolean(variant);
  // Once a vehicle of this variant is committed, its name and colour are locked by the server (M4B.5).
  const identityLocked = Boolean(variant?.identityLocked);
  const { createVariant, updateVariant } = useCatalogMutations();
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: empty });
  useEffect(() => { if (open) reset(variant ? fromDto(variant) : empty); }, [open, variant, reset]);
  const hex = watch('hexColour');

  const onSubmit = handleSubmit(async (v) => {
    const payload = toVariantPayload(v);
    try {
      if (isEdit && variant) {
        // A locked variant never sends its name / colour (they cannot change).
        const input = identityLocked ? { ...payload, name: undefined, colour: undefined } : payload;
        const saved = await updateVariant.mutateAsync({ id: variant.id, input });
        onSaved?.(saved);
        toast.success('Variant updated');
      } else {
        const saved = await createVariant.mutateAsync({ modelId, input: payload });
        onSaved?.(saved);
        toast.success('Variant added');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the variant'));
    }
  });

  const err = (k: keyof FormValues) => errors[k] && <p className="text-xs text-destructive">{errors[k]?.message as string}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit variant' : 'Add variant'} · <span className="font-normal text-muted-foreground">{modelLabel}</span></DialogTitle>
          <DialogDescription>The list price is the catalogue price only — scooters already in stock, bookings and quotations keep their own prices.</DialogDescription>
        </DialogHeader>
        {identityLocked && (
          <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Vehicles of this variant are booked, delivered or have sale, warranty or AMC history, so its name and colour can't change. Add a new variant for future stock instead. Price, specifications, hex colour and status can still be edited.
          </p>
        )}
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3" noValidate>
          <div className="space-y-1.5"><Label htmlFor="v-name">Variant name</Label><Input id="v-name" autoComplete="off" placeholder="e.g. Pro" readOnly={identityLocked} aria-readonly={identityLocked} className={identityLocked ? 'bg-muted' : undefined} {...register('name')} />{err('name')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-colour">Colour</Label><Input id="v-colour" autoComplete="off" placeholder="e.g. Teal" readOnly={identityLocked} aria-readonly={identityLocked} className={identityLocked ? 'bg-muted' : undefined} {...register('colour')} />{err('colour')}</div>
          <div className="space-y-1.5">
            <Label htmlFor="v-hex">Hex colour</Label>
            <div className="flex items-center gap-2">
              <Input id="v-hex" autoComplete="off" placeholder="#00B8A9" {...register('hexColour')} />
              <span aria-hidden className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: HEX_COLOUR_PATTERN.test(hex) ? hex : 'transparent' }} />
            </div>
            {err('hexColour')}
          </div>
          <div className="space-y-1.5"><Label htmlFor="v-price">Ex-showroom / list price (₹)</Label><Input id="v-price" type="number" min={0} step={1} {...register('priceRupees')} />{err('priceRupees')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-battery-type">Battery type</Label><Input id="v-battery-type" placeholder="e.g. Li-ion" {...register('batteryType')} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-battery-capacity">Battery capacity</Label><Input id="v-battery-capacity" placeholder="e.g. 3.2 kWh" {...register('batteryCapacity')} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-range">Range (km)</Label><Input id="v-range" type="number" min={0} step={1} {...register('rangeKm')} />{err('rangeKm')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-speed">Top speed (km/h)</Label><Input id="v-speed" type="number" min={0} step={1} {...register('topSpeedKmph')} />{err('topSpeedKmph')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-charge">Charging time (hrs)</Label><Input id="v-charge" type="number" min={0} step={0.1} {...register('chargingTimeHrs')} />{err('chargingTimeHrs')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-motor">Motor power (W)</Label><Input id="v-motor" type="number" min={0} step={1} {...register('motorPowerW')} />{err('motorPowerW')}</div>
          <div className="space-y-1.5"><Label htmlFor="v-warranty">Warranty (months)</Label><Input id="v-warranty" type="number" min={0} step={1} {...register('warrantyMonths')} />{err('warrantyMonths')}</div>
          <DialogFooter className="sm:col-span-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isEdit ? 'Save changes' : 'Add variant'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
