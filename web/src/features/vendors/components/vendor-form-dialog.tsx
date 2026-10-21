import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { VENDOR_TYPES, VENDOR_TYPE_LABEL, createVendorSchema, panFromGstin, type VendorDto, type VendorType } from '@azad/shared';
import { apiErrorMessage, apiFieldErrors } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/common/form-field';
import { useVendorMutations } from '../hooks';

const TEXT_FIELDS = [
  'name', 'contactPerson', 'mobile', 'altMobile', 'email', 'gstNumber', 'pan', 'address', 'city', 'state', 'gstStateCode',
  'bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName', 'upiId', 'notes',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type Form = Record<TextField, string> & { type: VendorType; creditDays: string; defaultForScooters: boolean };

const blank = (): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, ''])) as Record<TextField, string>),
  type: 'OTHER',
  creditDays: '0',
  defaultForScooters: false,
});
const fromVendor = (v: VendorDto): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, (v[k] as string | null) ?? ''])) as Record<TextField, string>),
  type: v.type,
  creditDays: String(v.creditDays),
  defaultForScooters: v.isDefaultScooterVendor,
});

/**
 * Add or edit a vendor: who they are (type, contact, GSTIN → PAN), how long they give to pay (credit days) and
 * where to pay them (bank / UPI). A scooter supplier can be made the default for new scooters.
 */
export function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
  defaultType,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vendor to edit; none → a new vendor. */
  vendor?: VendorDto | null;
  defaultType?: VendorType;
  onSaved?: (vendor: VendorDto) => void;
}): JSX.Element {
  const { create, update } = useVendorMutations();
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setF(vendor ? fromVendor(vendor) : { ...blank(), type: defaultType ?? 'OTHER' });
    setErrors({});
  }, [open, vendor, defaultType]);

  const set = (k: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => setF((s) => ({ ...s, [k]: e.target.value }));
  const derivedPan = panFromGstin(f.gstNumber.replace(/\s/g, '').toUpperCase());
  const pending = create.isPending || update.isPending;

  const submit = async (): Promise<void> => {
    const body = {
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, f[k].trim()])),
      // Empty PAN → taken from the GSTIN by the server.
      pan: f.pan.trim() || undefined,
      type: f.type,
      creditDays: Number(f.creditDays || 0),
      defaultForScooters: f.defaultForScooters,
    };
    // On an edit, identity fields left as they were are not re-checked (an old record may predate the checks).
    if (vendor) for (const k of ['gstNumber', 'pan', 'bankIfsc', 'bankAccountNumber', 'upiId'] as const) if (f[k].trim() === (vendor[k] ?? '')) delete (body as Record<string, unknown>)[k];
    const parsed = createVendorSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      const saved = vendor ? await update.mutateAsync({ id: vendor.id, body: parsed.data }) : await create.mutateAsync(parsed.data);
      toast.success(vendor ? `${saved.name} updated` : `Vendor ${saved.vendorNumber} added`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      const fields = apiFieldErrors(e);
      if (Object.keys(fields).length) setErrors(fields);
      toast.error(apiErrorMessage(e));
    }
  };

  const text = (k: TextField, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <FormField label={label} error={errors[k]}>
      <Input value={f[k]} onChange={set(k)} {...props} />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vendor ? `Edit ${vendor.name}` : 'New vendor'}</DialogTitle>
          <DialogDescription>Who you buy from — scooters, accessories, parts or services — and how you pay them.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            {text('name', 'Name *', { autoFocus: true, placeholder: 'e.g. Comptech Motors Pvt Ltd' })}
            <FormField label="Type" error={errors.type}>
              <Select value={f.type} onValueChange={(v) => setF((s) => ({ ...s, type: v as VendorType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_TYPES.map((t) => <SelectItem key={t} value={t}>{VENDOR_TYPE_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            {text('contactPerson', 'Contact person')}
            {text('mobile', 'Mobile', { inputMode: 'tel' })}
            {text('altMobile', 'Other phone', { inputMode: 'tel' })}
            {text('email', 'Email', { type: 'email' })}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-accent">Tax & credit</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {text('gstNumber', 'GSTIN', { placeholder: '15 characters', className: 'uppercase placeholder:normal-case' })}
              {text('pan', 'PAN', { placeholder: derivedPan ?? 'From the GSTIN', className: 'uppercase placeholder:normal-case' })}
              <FormField label="Credit days" error={errors.creditDays}>
                <Input type="number" min={0} max={365} value={f.creditDays} onChange={(e) => setF((s) => ({ ...s, creditDays: e.target.value }))} />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">Credit days: a bill is due this many days after its date (0 = pay at once). Unpaid bills past it show as overdue.</p>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-accent">Bank & UPI</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {text('bankAccountName', 'Account name')}
              {text('bankAccountNumber', 'Account number', { inputMode: 'numeric' })}
              {text('bankIfsc', 'IFSC', { placeholder: 'e.g. SBIN0001234', className: 'uppercase placeholder:normal-case' })}
              {text('bankName', 'Bank & branch')}
              {text('upiId', 'UPI ID', { placeholder: 'name@bank' })}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {text('city', 'City')}
            {text('state', 'State')}
            {/* From the GSTIN when there is one; typed only for an unregistered vendor (CGST+SGST vs IGST on purchases). */}
            {f.gstNumber.trim() ? null : text('gstStateCode', 'GST state code', { inputMode: 'numeric', placeholder: 'e.g. 24' })}
            <div className="sm:col-span-3">
              <FormField label="Address" error={errors.address}>
                <Textarea rows={2} value={f.address} onChange={set('address')} />
              </FormField>
            </div>
            <div className="sm:col-span-3">
              <FormField label="Notes" error={errors.notes}>
                <Textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Terms, delivery days, anything to remember" />
              </FormField>
            </div>
          </section>

          {(f.type === 'SCOOTER_SUPPLIER' || f.defaultForScooters) && (
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                <span className="font-medium">Default for new scooters</span>
                <span className="block text-xs text-muted-foreground">New scooters and CSV rows without a supplier are bought from this vendor.</span>
              </span>
              <Switch checked={f.defaultForScooters} onCheckedChange={(v) => setF((s) => ({ ...s, defaultForScooters: v }))} />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={pending}>{vendor ? 'Save changes' : 'Add vendor'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
