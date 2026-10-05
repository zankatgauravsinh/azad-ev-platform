import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { GENDERS, LEAD_STATUSES, Gender, LeadStatus, type CustomerDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { leadStatusLabel } from '@/lib/labels';
import { useModels } from '@/features/inventory/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateCustomer, useUpdateCustomer } from '../hooks';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile'),
  altPhone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid mobile').or(z.literal('')).optional(),
  email: z.string().trim().email('Invalid email').or(z.literal('')).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pin: z.string().trim().regex(/^\d{6}$/, 'PIN must be 6 digits').or(z.literal('')).optional(),
  gstStateCode: z.string().trim().regex(/^\d{2}$/, 'GST state code must be two digits').or(z.literal('')).optional(),
  occupation: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(GENDERS as [Gender, ...Gender[]]).or(z.literal('')).optional(),
  leadStatus: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]),
  source: z.string().optional(),
  preferredModelId: z.string().optional(),
  preferredColour: z.string().optional(),
  preferredFinanceOption: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const empty: FormValues = {
  name: '', phone: '', altPhone: '', email: '', address: '', city: '', state: 'Gujarat', pin: '', gstStateCode: '',
  occupation: '', dateOfBirth: '', gender: '', leadStatus: LeadStatus.NEW, source: '',
  preferredModelId: '', preferredColour: '', preferredFinanceOption: '',
};

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customer?: CustomerDto;
}): JSX.Element {
  const isEdit = Boolean(customer);
  const { data: models = [] } = useModels();
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    reset(
      customer
        ? {
            name: customer.name,
            phone: customer.phone,
            altPhone: customer.altPhone ?? '',
            email: customer.email ?? '',
            address: customer.address ?? '',
            city: customer.city ?? '',
            state: customer.state ?? '',
            pin: customer.pin ?? '',
            gstStateCode: customer.gstStateCode ?? '',
            occupation: customer.occupation ?? '',
            dateOfBirth: customer.dateOfBirth ? customer.dateOfBirth.slice(0, 10) : '',
            gender: customer.gender ?? '',
            leadStatus: customer.leadStatus,
            source: customer.source ?? '',
            preferredModelId: customer.preferredModel?.id ?? '',
            preferredColour: customer.preferredColour ?? '',
            preferredFinanceOption: customer.preferredFinanceOption ?? '',
          }
        : empty,
    );
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      name: v.name,
      phone: v.phone,
      altPhone: v.altPhone || undefined,
      email: v.email || undefined,
      address: v.address || undefined,
      city: v.city || undefined,
      state: v.state || undefined,
      pin: v.pin || undefined,
      // Sent even when empty so an existing code can be cleared; never derived from the state above.
      gstStateCode: v.gstStateCode ?? '',
      occupation: v.occupation || undefined,
      dateOfBirth: v.dateOfBirth ? new Date(v.dateOfBirth) : undefined,
      gender: v.gender || undefined,
      source: v.source || undefined,
      preferredModelId: v.preferredModelId || undefined,
      preferredColour: v.preferredColour || undefined,
      preferredFinanceOption: v.preferredFinanceOption || undefined,
    };
    try {
      if (isEdit) {
        await update.mutateAsync(payload);
        toast.success('Customer updated');
      } else {
        await create.mutateAsync({ ...payload, leadStatus: v.leadStatus });
        toast.success('Customer added');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save customer'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit customer' : 'Add customer'}</DialogTitle>
          <DialogDescription>Capture contact, preferences and lead details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Mobile" error={errors.phone?.message}><Input inputMode="numeric" {...register('phone')} /></Field>
          <Field label="Alternate mobile" error={errors.altPhone?.message}><Input inputMode="numeric" {...register('altPhone')} /></Field>
          <Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input {...register('address')} /></Field>
          <Field label="City"><Input {...register('city')} /></Field>
          <Field label="State"><Input {...register('state')} /></Field>
          <Field label="PIN" error={errors.pin?.message}><Input inputMode="numeric" {...register('pin')} /></Field>
          <Field label="GST state code (optional)" error={errors.gstStateCode?.message}><Input inputMode="numeric" maxLength={2} placeholder="Two digits" {...register('gstStateCode')} /></Field>
          <Field label="Occupation"><Input {...register('occupation')} /></Field>
          <Field label="Date of birth"><Input type="date" {...register('dateOfBirth')} /></Field>
          <Field label="Gender">
            <Controller control={control} name="gender" render={({ field }) => (
              <Select value={field.value || ''} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g}>{g[0] + g.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          {!isEdit && (
            <Field label="Lead status">
              <Controller control={control} name="leadStatus" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{leadStatusLabel(s)}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
          )}
          <Field label="Lead source"><Input placeholder="Walk-in, Referral…" {...register('source')} /></Field>
          <Field label="Preferred model">
            <Controller control={control} name="preferredModelId" render={({ field }) => (
              <Select value={field.value || ''} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>{models.map((m) => <SelectItem key={m.id} value={m.id}>{m.brand} {m.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Preferred colour"><Input {...register('preferredColour')} /></Field>
          <Field label="Preferred finance"><Input placeholder="Cash / Finance / Exchange" {...register('preferredFinanceOption')} /></Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
