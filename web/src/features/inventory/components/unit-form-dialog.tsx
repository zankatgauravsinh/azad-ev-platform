import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Lock, Pencil, Percent, Plus, ScanLine, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { PURCHASE_COST_PERMISSION, UNIT_STATUSES, UNIT_WARRANTY_MONTH_FIELDS, UnitStatus, WARRANTY_EXTRAS_MAX, WARRANTY_MONTHS_MAX, computePurchaseCost, warrantyExtrasSchema, type CreateUnitInput, type FinancePayMethod, type UnitWarrantyMonthField, type UpdateUnitInput } from '@azad/shared';
import { useCompanySettings } from '@/features/settings/hooks';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { useAuth } from '@/features/auth/auth-context';
import { VariantFormDialog } from '@/features/catalog/components/variant-form-dialog';
import { NO_VENDOR, VendorSelect } from '@/features/vendors/components/vendor-select';
import { VendorFormDialog } from '@/features/vendors/components/vendor-form-dialog';
import { useVendorOptions } from '@/features/vendors/hooks';
import { PAY_METHODS } from '@/features/accessories/components/purchase-form-dialog';
import { Checkbox } from '@/components/ui/checkbox';
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
/** Blank → the company default applies; 0 → not covered. */
const optionalMonths = z.union([z.literal(''), z.coerce.number().int('Whole months').min(0, 'Cannot be negative').max(WARRANTY_MONTHS_MAX, `At most ${WARRANTY_MONTHS_MAX}`)]);

/** The four component warranty inputs, in the order they are shown. */
const WARRANTY_INPUTS: { field: UnitWarrantyMonthField; label: string }[] = [
  { field: UNIT_WARRANTY_MONTH_FIELDS.MOTOR, label: 'Motor' },
  { field: UNIT_WARRANTY_MONTH_FIELDS.BATTERY, label: 'Battery' },
  { field: UNIT_WARRANTY_MONTH_FIELDS.CONTROLLER, label: 'Controller' },
  { field: UNIT_WARRANTY_MONTH_FIELDS.CHARGER, label: 'Charger' },
];

const formSchema = z.object({
  modelId: z.string().uuid('Select a model'),
  variantId: z.string().uuid('Select a variant'),
  vin: z.string().trim().min(3, 'VIN is required'),
  motorNumber: z.string().trim().min(1, 'Required'),
  batteryNumber: z.string().trim().min(1, 'Required'),
  controllerNumber: z.string().max(64).optional(),
  chargerNumber: z.string().max(64).optional(),
  motorWarrantyMonths: optionalMonths,
  batteryWarrantyMonths: optionalMonths,
  controllerWarrantyMonths: optionalMonths,
  chargerWarrantyMonths: optionalMonths,
  // Extra items typed in for the warranty card (name + months), added with the + button.
  warrantyExtras: warrantyExtrasSchema,
  // A scooter cannot have been bought after today (the server checks in the company's time zone too).
  purchaseDate: z.string().optional().refine((v) => !v || v <= todayDateInput(), 'Purchase date cannot be in the future'),
  // Purchase cost — shown and sent only with inventory.cost (the owner, by default).
  purchasePrice: optionalRupees,
  purchaseGstRate: z.union([z.literal(''), z.coerce.number().min(0, 'Cannot be negative').max(100, 'At most 100%')]),
  purchaseGstAmount: optionalRupees,
  transportCharge: optionalRupees,
  sellingPrice: optionalRupees,
  /** A vendor id, NO_VENDOR, or '' (a new scooter not yet given one: the server uses the default vendor). */
  vendorId: z.string(),
  /** The vendor's bill (invoice) number for this scooter. */
  vendorBillNumber: z.string().max(60).optional(),
  // Paid to the vendor when added (owner only): a vendor payment of its purchase cost.
  paidNow: z.boolean(),
  payMethod: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']),
  paidOn: z.string().optional().refine((v) => !v || v <= todayDateInput(), 'The payment date cannot be in the future'),
  payReference: z.string().max(120).optional(),
  location: z.string().optional(),
  keyNumber: z.string().max(30).optional(),
  notes: z.string().optional(),
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]),
});
type FormValues = z.infer<typeof formSchema>;

const normalise = (value: string): string => value.trim().toUpperCase();

/** A purchase-order line a new scooter is received against: its vendor, variant and price fill the form. */
export interface ReceiveAgainstLine {
  lineId: string;
  poNumber: string;
  vendorId: string;
  modelId: string;
  variantId: string;
  description: string;
  /** Price per scooter before GST (paise). */
  unitCost: string;
  gstRateBp: number;
  /** Still to receive on the line. */
  remaining: number;
}

/**
 * Add / edit a scooter. The vehicle's catalogue identity is always a curated variant (model → variant,
 * the colour comes with the variant); nothing is created from free text. Which identity fields an edit
 * may change comes from the server's `unit.identity` policy — the server re-checks every change.
 * With `orderLine` it receives a scooter against a purchase order: vendor and variant come from the order,
 * the price from the line, and "Save & next" keeps them for the next scooter of the line.
 */
export function UnitFormDialog({
  open,
  onOpenChange,
  unit,
  orderLine,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit?: UnitDetail;
  orderLine?: ReceiveAgainstLine;
  onSaved?: () => void;
}): JSX.Element {
  const isEdit = Boolean(unit);
  const receiving = !isEdit && Boolean(orderLine);
  const [receivedHere, setReceivedHere] = useState(0);
  const { can } = useAuth();
  const canCost = can(PURCHASE_COST_PERMISSION);
  // GST paid: worked out from a rate by default; the pencil switches to typing the amount.
  const [gstAsAmount, setGstAsAmount] = useState(false);
  // Settings give the default GST rate (owner) and the default warranty months (anyone who may read them).
  const { data: settings } = useCompanySettings(canCost || can('settings.view'));
  const defaultGstRate = Number(settings?.taxPercentage ?? 0) > 0 ? Number(settings!.taxPercentage) : 5;
  const canCreateVariant = can('inventory.create');
  const { data: activeModels = [] } = useModels();
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit(unit?.id ?? '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [vinTaken, setVinTaken] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [addVendorOpen, setAddVendorOpen] = useState(false);
  const canAddVendor = can('vendors.manage');
  const { data: vendorOptions } = useVendorOptions(open);

  // Locks for an edit (an add is always fully editable).
  const catalogueLocked = isEdit && !unit?.identity?.catalogueEditable;
  const identificationLocked = isEdit && !unit?.identity?.identificationEditable;
  // Issued with the warranty card on delivery; from then on the owner changes them from the warranty.
  const warrantyLocked = isEdit && Boolean(unit?.warrantyIssued);
  const defaultWarrantyMonths = settings?.defaultWarrantyMonths;

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
  const extras = useFieldArray({ control, name: 'warrantyExtras' });

  useEffect(() => {
    if (!open) return;
    reset(unit ? toFormValues(unit) : orderLine ? fromOrderLine(orderLine) : emptyValues());
    setReceivedHere(0);
    // A typed GST amount (no rate stored) opens in amount mode; otherwise the rate, defaulting for a new one.
    setGstAsAmount(Boolean(unit && unit.purchaseGstRateBp == null && unit.purchaseGst && unit.purchaseGst !== '0'));
    setVinTaken(false);
  }, [open, unit, orderLine, reset]);

  // A new scooter is bought from the default scooter vendor unless another is picked.
  const defaultVendorId = vendorOptions?.defaultScooterVendorId;
  useEffect(() => {
    if (open && !unit && defaultVendorId && watch('vendorId') === '') setValue('vendorId', defaultVendorId);
  }, [open, unit, defaultVendorId, setValue, watch]);

  // A new scooter's warranty months start from the company default.
  useEffect(() => {
    if (!open || unit || !defaultWarrantyMonths) return;
    for (const { field } of WARRANTY_INPUTS) if (watch(field) === '') setValue(field, defaultWarrantyMonths);
  }, [open, unit, defaultWarrantyMonths, setValue, watch]);

  const modelId = watch('modelId');
  // A new rate field starts from the company's tax rate (5% when none is set).
  useEffect(() => {
    if (open && canCost && !orderLine && watch('purchaseGstRate') === '' && !(unit && unit.purchaseGstRateBp == null && unit.purchaseGst && unit.purchaseGst !== '0')) setValue('purchaseGstRate', defaultGstRate);
  }, [open, canCost, defaultGstRate, unit, orderLine, setValue, watch]);
  const [price, gstRate, gstAmount, transport] = watch(['purchasePrice', 'purchaseGstRate', 'purchaseGstAmount', 'transportCharge']);
  // The same calculation the server stores (computePurchaseCost), previewed as the owner types.
  const purchaseBreakdown = useMemo(() => {
    const paise = (v: number | '' | undefined): bigint => BigInt(v === '' || v === undefined || !Number.isFinite(Number(v)) ? 0 : rupeesToPaise(Number(v)));
    return computePurchaseCost(paise(price), gstAsAmount ? { amount: paise(gstAmount) } : { rateBp: Math.round(Number(gstRate || 0) * 100) }, paise(transport));
  }, [price, gstRate, gstAmount, transport, gstAsAmount]);
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

  // "Save & next" (receiving several scooters of an order line): keeps the dialog open for the next one.
  const keepOpen = useRef(false);
  const remainingOnLine = orderLine ? orderLine.remaining - receivedHere : 0;
  const paidNow = watch('paidNow');

  const onSubmit = handleSubmit(async (values) => {
    if (vinTaken) {
      toast.error('This VIN already exists');
      return;
    }
    // Fields that are not part of the vehicle's identity — sent as before.
    const details = {
      purchaseDate: values.purchaseDate ? new Date(values.purchaseDate) : undefined,
      ...(canCost
        ? {
            purchasePrice: values.purchasePrice === '' ? 0 : Number(rupeesToPaise(values.purchasePrice)),
            transportCharge: values.transportCharge === '' ? 0 : Number(rupeesToPaise(values.transportCharge)),
            ...(gstAsAmount
              ? { purchaseGst: values.purchaseGstAmount === '' ? 0 : Number(rupeesToPaise(values.purchaseGstAmount)) }
              : { purchaseGstRate: values.purchaseGstRate === '' ? 0 : values.purchaseGstRate }),
          }
        : {}),
      // Blank selling price: left out (a new unit then takes the variant's list price; an edit keeps its price).
      ...(values.sellingPrice === '' ? {} : { sellingPrice: Number(rupeesToPaise(values.sellingPrice)) }),
      // The vendor: on an edit only when it changes; NO_VENDOR clears it.
      ...(!isEdit || values.vendorId !== (unit?.vendorId ?? NO_VENDOR) ? { vendorId: values.vendorId === NO_VENDOR ? null : values.vendorId || undefined } : {}),
      // The vendor's bill number: sent even when empty on an edit, so a wrong one can be removed.
      vendorBillNumber: isEdit ? values.vendorBillNumber?.trim() ?? '' : values.vendorBillNumber?.trim() || undefined,
      location: values.location || undefined,
      // Sent even when empty on an edit, so a wrong key number can be removed.
      keyNumber: isEdit ? values.keyNumber ?? '' : values.keyNumber || undefined,
      notes: values.notes || undefined,
    };
    const months = (field: UnitWarrantyMonthField): number | null => (values[field] === '' ? null : Number(values[field]));
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
        // Controller / charger: a blank one can always be filled in; a recorded one only while not locked.
        for (const field of ['controllerNumber', 'chargerNumber'] as const) {
          const next = normalise(values[field] ?? '') || null;
          if (next !== (unit[field] ?? null) && (!identificationLocked || !unit[field])) identity[field] = next;
        }
        // Warranty months: only those that change, and only until the warranty card is issued.
        const warranty: UpdateUnitInput = {};
        if (!warrantyLocked) {
          for (const { field } of WARRANTY_INPUTS) if (months(field) !== (unit[field] ?? null)) warranty[field] = months(field);
          if (JSON.stringify(values.warrantyExtras) !== JSON.stringify(unit.warrantyExtras ?? [])) warranty.warrantyExtras = values.warrantyExtras;
        }
        await updateUnit.mutateAsync({ ...details, ...identity, ...warranty });
        toast.success('Scooter updated');
      } else {
        const input: CreateUnitInput = {
          ...details,
          variantId: values.variantId,
          vin: normalise(values.vin),
          motorNumber: normalise(values.motorNumber),
          batteryNumber: normalise(values.batteryNumber),
          controllerNumber: normalise(values.controllerNumber ?? '') || undefined,
          chargerNumber: normalise(values.chargerNumber ?? '') || undefined,
          ...Object.fromEntries(WARRANTY_INPUTS.map(({ field }) => [field, months(field) ?? undefined])),
          ...(values.warrantyExtras.length ? { warrantyExtras: values.warrantyExtras } : {}),
          status: values.status,
          ...(orderLine ? { purchaseOrderLineId: orderLine.lineId } : {}),
          ...(canCost && values.paidNow ? { purchasePayment: { method: values.payMethod, paidAt: values.paidOn ? new Date(values.paidOn) : undefined, reference: values.payReference?.trim() || undefined } } : {}),
        } as CreateUnitInput;
        await createUnit.mutateAsync(input);
        toast.success(orderLine ? `Scooter received against ${orderLine.poNumber}` : values.paidNow ? 'Scooter added — paid to the vendor' : 'Scooter added');
        onSaved?.();
        if (orderLine && keepOpen.current && remainingOnLine > 1) {
          setReceivedHere((n) => n + 1);
          // Same order line, vendor and price: only the vehicle's own numbers change.
          for (const field of ['vin', 'motorNumber', 'batteryNumber', 'controllerNumber', 'chargerNumber', 'vendorBillNumber', 'keyNumber'] as const) setValue(field, '');
          keepOpen.current = false;
          return;
        }
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
          <DialogTitle>{isEdit ? 'Edit scooter' : receiving ? `Receive scooter — ${orderLine!.poNumber}` : 'Add scooter'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `VIN ${unit?.vin}`
              : receiving
                ? `${orderLine!.description} · ${remainingOnLine} still to receive on this line. Vendor, variant and price come from the order.`
                : 'Register a new unit in inventory.'}
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
                  disabled={catalogueLocked || receiving}
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
                  <Select value={field.value} disabled={catalogueLocked || !modelId || receiving} onValueChange={field.onChange}>
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
              {canCreateVariant && !catalogueLocked && !receiving && modelIsActive && (
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
          <Field label="Controller number" htmlFor="unit-controller" error={errors.controllerNumber?.message}>
            <Input id="unit-controller" className={`uppercase ${identificationLocked && unit?.controllerNumber ? 'bg-muted' : ''}`} placeholder="Optional" readOnly={identificationLocked && Boolean(unit?.controllerNumber)} {...register('controllerNumber')} />
          </Field>
          <Field label="Charger number" htmlFor="unit-charger" error={errors.chargerNumber?.message}>
            <Input id="unit-charger" className={`uppercase ${identificationLocked && unit?.chargerNumber ? 'bg-muted' : ''}`} placeholder="Optional" readOnly={identificationLocked && Boolean(unit?.chargerNumber)} {...register('chargerNumber')} />
          </Field>
          <Field label="Purchase date" htmlFor="unit-purchase-date" error={errors.purchaseDate?.message}>
            <Input id="unit-purchase-date" type="date" max={todayDateInput()} {...register('purchaseDate')} />
          </Field>

          <div className="space-y-3 rounded-lg border p-3 sm:col-span-2" role="group" aria-label="Warranty months">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              Warranty (months)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {WARRANTY_INPUTS.map(({ field, label }) => (
                <Field key={field} label={label} htmlFor={`unit-${field}`} error={errors[field]?.message}>
                  <Input
                    id={`unit-${field}`}
                    type="number"
                    min={0}
                    max={WARRANTY_MONTHS_MAX}
                    step={1}
                    inputMode="numeric"
                    placeholder={defaultWarrantyMonths ? String(defaultWarrantyMonths) : 'Default'}
                    className={warrantyLocked ? 'bg-muted' : undefined}
                    readOnly={warrantyLocked}
                    aria-readonly={warrantyLocked}
                    {...register(field)}
                  />
                </Field>
              ))}
            </div>
            {extras.fields.length > 0 && (
              <ul className="space-y-2" aria-label="Extra warranty items">
                {extras.fields.map((item, i) => {
                  const err = errors.warrantyExtras?.[i];
                  return (
                    <li key={item.id} className="space-y-1">
                      <div className="flex gap-2">
                        <Input
                          aria-label={`Extra item ${i + 1} name`}
                          placeholder="Item name, e.g. Hub bearings"
                          maxLength={60}
                          className={`flex-1 ${warrantyLocked ? 'bg-muted' : ''}`}
                          readOnly={warrantyLocked}
                          {...register(`warrantyExtras.${i}.name`)}
                        />
                        <Input
                          aria-label={`Extra item ${i + 1} months`}
                          type="number"
                          min={1}
                          max={WARRANTY_MONTHS_MAX}
                          step={1}
                          inputMode="numeric"
                          placeholder="Months"
                          className={`w-24 ${warrantyLocked ? 'bg-muted' : ''}`}
                          readOnly={warrantyLocked}
                          {...register(`warrantyExtras.${i}.months`)}
                        />
                        {!warrantyLocked && (
                          <Button type="button" variant="outline" size="icon" aria-label={`Remove extra item ${i + 1}`} onClick={() => extras.remove(i)}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {(err?.name?.message || err?.months?.message) && <p className="text-xs text-destructive">{err?.name?.message ?? err?.months?.message}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {(errors.warrantyExtras?.root?.message || errors.warrantyExtras?.message) && (
              <p className="text-xs text-destructive">{errors.warrantyExtras?.root?.message ?? errors.warrantyExtras?.message}</p>
            )}
            {!warrantyLocked && extras.fields.length < WARRANTY_EXTRAS_MAX && (
              <Button type="button" variant="outline" size="sm" onClick={() => extras.append({ name: '', months: defaultWarrantyMonths || 12 })}>
                <Plus className="h-4 w-4" /> Add warranty item
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {warrantyLocked
                ? 'The warranty card has been issued. The owner changes these months and items from the warranty, which regenerates the card.'
                : 'The warranty card is issued from these on delivery, starting on the delivery date. 0 = not covered; blank = the company default. Use + to add your own items to the card.'}
            </p>
          </div>

          {canCost && (
            <div className="space-y-3 rounded-lg border p-3 sm:col-span-2" aria-label="Purchase cost">
              <p className="text-sm font-semibold">Purchase <span className="text-xs font-normal text-muted-foreground">— visible to the owner only</span></p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Purchase price (₹)" htmlFor="unit-purchase-price" error={errors.purchasePrice?.message}>
                  <Input id="unit-purchase-price" type="number" min={0} step="0.01" {...register('purchasePrice')} />
                </Field>
                {gstAsAmount ? (
                  <Field label="GST paid (₹)" htmlFor="unit-purchase-gst" error={errors.purchaseGstAmount?.message}>
                    <div className="flex gap-2">
                      <Input id="unit-purchase-gst" type="number" min={0} step="0.01" {...register('purchaseGstAmount')} />
                      <Button type="button" variant="outline" size="icon" aria-label="Work GST out from a rate instead" onClick={() => setGstAsAmount(false)}><Percent className="h-4 w-4" /></Button>
                    </div>
                  </Field>
                ) : (
                  <Field label="GST rate (%)" htmlFor="unit-purchase-gst-rate" error={errors.purchaseGstRate?.message}>
                    <div className="flex gap-2">
                      <Input id="unit-purchase-gst-rate" type="number" min={0} max={100} step="0.01" {...register('purchaseGstRate')} />
                      <Button type="button" variant="outline" size="icon" aria-label="Type the GST amount instead" onClick={() => { setValue('purchaseGstAmount', purchaseBreakdown ? paiseToRupees(purchaseBreakdown.purchaseGst) : ''); setGstAsAmount(true); }}><Pencil className="h-4 w-4" /></Button>
                    </div>
                  </Field>
                )}
                <Field label="Transport charge (₹)" htmlFor="unit-transport" error={errors.transportCharge?.message}>
                  <Input id="unit-transport" type="number" min={0} step="0.01" {...register('transportCharge')} />
                </Field>
              </div>
              <dl className="flex flex-wrap justify-between gap-x-6 gap-y-1 rounded-md bg-secondary px-3 py-2 text-sm" aria-label="Purchase cost total">
                <div className="flex gap-2"><dt className="text-muted-foreground">GST paid</dt><dd className="tabular-nums">{purchaseBreakdown ? formatPaise(purchaseBreakdown.purchaseGst) : '—'}</dd></div>
                <div className="flex gap-2 font-semibold"><dt>Purchase cost</dt><dd className="tabular-nums">{purchaseBreakdown ? formatPaise(purchaseBreakdown.purchaseCost) : '—'}</dd></div>
              </dl>
              {isEdit && unit ? (
                <p className="text-xs text-muted-foreground">
                  {unit.costInExpenses
                    ? 'Bought before per-scooter tracking: its cost was recorded as a Vehicle Purchase expense.'
                    : unit.purchasePaid
                      ? 'Paid to the vendor. Pay or undo payments from the vendor’s page.'
                      : 'Owed to the vendor until paid — pay it from the scooter or the vendor’s page.'}
                </p>
              ) : (
                <div className="space-y-3 border-t pt-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Controller control={control} name="paidNow" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} aria-label="Paid to the vendor now" />} />
                    Paid to the vendor now
                  </label>
                  {paidNow ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Paid by" htmlFor="unit-pay-method">
                        <Controller
                          control={control}
                          name="payMethod"
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={(v) => field.onChange(v as FinancePayMethod)}>
                              <SelectTrigger id="unit-pay-method"><SelectValue /></SelectTrigger>
                              <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                      <Field label="Paid on" htmlFor="unit-paid-on" error={errors.paidOn?.message}>
                        <Input id="unit-paid-on" type="date" max={todayDateInput()} placeholder="Purchase date" {...register('paidOn')} />
                      </Field>
                      <Field label="Reference (optional)" htmlFor="unit-pay-ref">
                        <Input id="unit-pay-ref" maxLength={120} placeholder="UTR / cheque no." {...register('payReference')} />
                      </Field>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not paid yet: the purchase cost is owed to the vendor (due after their credit days) until you pay it.</p>
                  )}
                </div>
              )}
            </div>
          )}
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
          <Field label="Bought from (vendor)" htmlFor="unit-vendor">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Controller control={control} name="vendorId" render={({ field }) => <VendorSelect id="unit-vendor" value={field.value || NO_VENDOR} onChange={field.onChange} prefer="SCOOTER_SUPPLIER" disabled={receiving} />} />
              </div>
              {canAddVendor && !receiving && (
                <Button type="button" variant="outline" size="icon" aria-label="Add a vendor" title="Add a vendor" onClick={() => setAddVendorOpen(true)}><Plus className="h-4 w-4" /></Button>
              )}
            </div>
            {isEdit && unit?.supplier && !unit.vendorId && <p className="text-xs text-muted-foreground">Recorded as “{unit.supplier}” — pick the vendor it was bought from.</p>}
          </Field>
          <Field label="Vendor bill no." htmlFor="unit-vendor-bill">
            <Input id="unit-vendor-bill" maxLength={60} placeholder="The vendor's invoice no." {...register('vendorBillNumber')} />
          </Field>
          <Field label="Location" htmlFor="unit-location">
            <Input id="unit-location" placeholder="e.g. Showroom floor" {...register('location')} />
          </Field>
          <Field label="Key no." htmlFor="unit-key">
            <Input id="unit-key" className="uppercase" placeholder="Printed on the RTO invoice" {...register('keyNumber')} />
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
            {receiving && remainingOnLine > 1 && (
              <Button type="submit" variant="outline" disabled={isSubmitting || vinTaken} onClick={() => { keepOpen.current = true; }}>
                Save &amp; next
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting || vinTaken} onClick={() => { keepOpen.current = false; }}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : receiving ? 'Receive scooter' : 'Add scooter'}
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
        {canAddVendor && (
          <VendorFormDialog open={addVendorOpen} onOpenChange={setAddVendorOpen} defaultType="SCOOTER_SUPPLIER" onSaved={(saved) => setValue('vendorId', saved.id)} />
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
    controllerNumber: '',
    chargerNumber: '',
    motorWarrantyMonths: '',
    batteryWarrantyMonths: '',
    controllerWarrantyMonths: '',
    chargerWarrantyMonths: '',
    warrantyExtras: [],
    purchaseDate: '',
    purchasePrice: '',
    purchaseGstRate: '',
    purchaseGstAmount: '',
    transportCharge: '',
    sellingPrice: '',
    vendorId: '',
    vendorBillNumber: '',
    paidNow: false,
    payMethod: 'BANK_TRANSFER',
    paidOn: '',
    payReference: '',
    location: '',
    keyNumber: '',
    notes: '',
    status: UnitStatus.AVAILABLE,
  };
}

/** A new scooter received against an order line: the order's vendor, the line's variant and price. */
function fromOrderLine(line: ReceiveAgainstLine): FormValues {
  return {
    ...emptyValues(),
    modelId: line.modelId,
    variantId: line.variantId,
    vendorId: line.vendorId,
    purchaseDate: todayDateInput(),
    purchasePrice: paiseToRupees(line.unitCost),
    purchaseGstRate: line.gstRateBp / 100,
    transportCharge: 0,
  };
}

function toFormValues(unit: UnitDetail): FormValues {
  return {
    modelId: unit.variant.model.id,
    variantId: unit.variant.id,
    vin: unit.vin,
    motorNumber: unit.motorNumber,
    batteryNumber: unit.batteryNumber,
    controllerNumber: unit.controllerNumber ?? '',
    chargerNumber: unit.chargerNumber ?? '',
    motorWarrantyMonths: unit.motorWarrantyMonths ?? '',
    batteryWarrantyMonths: unit.batteryWarrantyMonths ?? '',
    controllerWarrantyMonths: unit.controllerWarrantyMonths ?? '',
    chargerWarrantyMonths: unit.chargerWarrantyMonths ?? '',
    warrantyExtras: unit.warrantyExtras ?? [],
    purchaseDate: unit.purchaseDate ? unit.purchaseDate.slice(0, 10) : '',
    purchasePrice: unit.purchasePrice !== undefined ? paiseToRupees(unit.purchasePrice) : '',
    purchaseGstRate: unit.purchaseGstRateBp != null ? unit.purchaseGstRateBp / 100 : '',
    purchaseGstAmount: unit.purchaseGst !== undefined ? paiseToRupees(unit.purchaseGst) : '',
    transportCharge: unit.transportCharge !== undefined ? paiseToRupees(unit.transportCharge) : '',
    sellingPrice: paiseToRupees(unit.sellingPrice),
    vendorId: unit.vendorId ?? NO_VENDOR,
    vendorBillNumber: unit.vendorBillNumber ?? '',
    paidNow: false,
    payMethod: 'BANK_TRANSFER',
    paidOn: '',
    payReference: '',
    location: unit.location ?? '',
    keyNumber: unit.keyNumber ?? '',
    notes: unit.notes ?? '',
    status: unit.status,
  };
}
