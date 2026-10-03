import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  BACKUP_FREQUENCIES, CURRENCIES, DATE_FORMATS, LANGUAGES, TIME_FORMATS, WEEKDAYS,
  updateCompanySettingsSchema, type UpdateCompanySettingsInput,
} from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCompanySettings, useUpdateSettings } from '../hooks';
import { settingsApi } from '../api';

type FormValues = UpdateCompanySettingsInput;

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/api\/v1$/, '');

export function SettingsPage(): JSX.Element {
  const { can } = useAuth();
  // Company configuration is gated by settings.manage (OWNER in the seed). Backend remains authoritative.
  // NOTE: the logo/favicon uploads below are backed by a separate permission (settings.branding, held by
  // more roles), but they currently sit inside this settings.manage fieldset. Granting branding to those
  // extra roles needs a separate focused UI change (lift the ImageUploads out of this fieldset and gate
  // them with can('settings.branding')); intentionally NOT done here to avoid a structural change.
  const canManageSettings = can('settings.manage');
  const { data: settings, isLoading } = useCompanySettings();
  const update = useUpdateSettings();

  const form = useForm<FormValues>({ resolver: zodResolver(updateCompanySettingsSchema) as never });
  const { control, register, handleSubmit, reset, watch, formState: { errors, isDirty, isSubmitting } } = form;

  useEffect(() => {
    if (settings) {
      reset({
        businessName: settings.businessName, legalName: settings.legalName ?? '', dealerName: settings.dealerName ?? '', address: settings.address ?? '',
        city: settings.city ?? '', state: settings.state ?? '', phone: settings.phone ?? '', email: settings.email ?? '',
        website: settings.website ?? '', tagline: settings.tagline ?? '',
        currency: settings.currency as never, timezone: settings.timezone, language: settings.language as never,
        dateFormat: settings.dateFormat as never, timeFormat: settings.timeFormat as never,
        gstEnabled: settings.gstEnabled, gstNumber: settings.gstNumber ?? '', taxPercentage: Number(settings.taxPercentage),
        invoicePrefix: settings.invoicePrefix, bookingPrefix: settings.bookingPrefix, quotationPrefix: settings.quotationPrefix,
        receiptPrefix: settings.receiptPrefix, jobCardPrefix: settings.jobCardPrefix,
        defaultWarrantyMonths: settings.defaultWarrantyMonths, serviceReminderDays: settings.serviceReminderDays,
        warrantyEnabled: settings.warrantyEnabled, amcEnabled: settings.amcEnabled, warrantyReminderDays: settings.warrantyReminderDays,
        financeEnabled: settings.financeEnabled, expensePrefix: settings.expensePrefix, vendorPrefix: settings.vendorPrefix,
        incomePrefix: settings.incomePrefix, bankPrefix: settings.bankPrefix, financeGstRate: settings.financeGstRate,
        financialYearStartMonth: settings.financialYearStartMonth, openingCash: Number(settings.openingCash) / 100, openingBank: Number(settings.openingBank) / 100,
        lowCashThreshold: Number(settings.lowCashThreshold) / 100, largeExpenseThreshold: Number(settings.largeExpenseThreshold) / 100,
        freeService1Km: settings.freeService1Km, freeService1Days: settings.freeService1Days,
        freeService2Km: settings.freeService2Km, freeService2Days: settings.freeService2Days,
        freeService3Km: settings.freeService3Km, freeService3Days: settings.freeService3Days,
        primaryColor: settings.primaryColor, secondaryColor: settings.secondaryColor,
        workingDays: settings.workingDays as FormValues['workingDays'], workingHours: settings.workingHours,
        notifyDelivery: settings.notifyDelivery, notifyPayment: settings.notifyPayment, notifyService: settings.notifyService,
        notifyInventory: settings.notifyInventory, notifyWarranty: settings.notifyWarranty, desktopNotifications: settings.desktopNotifications,
        emailEnabled: settings.emailEnabled, smsEnabled: settings.smsEnabled, whatsappEnabled: settings.whatsappEnabled,
        backupEnabled: settings.backupEnabled, backupFrequency: settings.backupFrequency,
        termsAndConditions: settings.termsAndConditions ?? '', invoiceFooter: settings.invoiceFooter ?? '',
      });
    }
  }, [settings, reset]);

  // Unsaved-changes guards: in-app navigation + browser unload.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values as UpdateCompanySettingsInput);
      reset(values); // clears dirty state
      toast.success('Settings saved');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save settings'));
    }
  });

  if (isLoading || !settings) {
    return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full" /></div>;
  }

  const values = watch();

  return (
    <div className="pb-20">
      <PageHeader
        title="Settings"
        description={canManageSettings ? 'Configure how your showroom works.' : 'Company configuration (read-only for your role).'}
      />

      <form onSubmit={onSubmit}>
        <fieldset disabled={!canManageSettings}>
          <Tabs defaultValue="general">
            {/* Horizontal scroll strip so the 9 tabs never wrap/overlap on narrow screens. */}
            <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="w-max">
                {['general', 'branding', 'sales', 'invoice', 'service', 'finance', 'notifications', 'localization', 'backup'].map((t) => (
                  <TabsTrigger key={t} value={t}>{titleCase(t)}</TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="general">
              <Panel>
                <Grid>
                  <Field label="Business name" error={errors.businessName?.message}><Input {...register('businessName')} /></Field>
                  <Field label="Legal name"><Input {...register('legalName')} /></Field>
                  <Field label="Dealer line" className="sm:col-span-2"><Input placeholder="Authorized Dealer – …" {...register('dealerName')} /></Field>
                  <Field label="Phone(s)" error={errors.phone?.message}><Input placeholder="Comma-separated" {...register('phone')} /></Field>
                  <Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
                  <Field label="Website"><Input placeholder="www.example.com" {...register('website')} /></Field>
                  <Field label="Tagline" error={errors.tagline?.message}><Input placeholder="POWERING TOMORROW" {...register('tagline')} /></Field>
                  <Field label="Address" className="sm:col-span-2"><Input {...register('address')} /></Field>
                  <Field label="City"><Input {...register('city')} /></Field>
                  <Field label="State"><Input {...register('state')} /></Field>
                  <Field label="Working hours" error={errors.workingHours?.message}><Input placeholder="10:00-19:00" {...register('workingHours')} /></Field>
                  <Field label="Working days" className="sm:col-span-2">
                    <Controller control={control} name="workingDays" render={({ field }) => (
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map((d) => {
                          const on = (field.value ?? []).includes(d);
                          return (
                            <button key={d} type="button" disabled={!canManageSettings}
                              onClick={() => field.onChange(on ? (field.value ?? []).filter((x: string) => x !== d) : [...(field.value ?? []), d])}
                              className={`rounded-md border px-3 py-1 text-sm ${on ? 'border-accent bg-accent/15 text-accent' : 'text-muted-foreground'}`}>{d}</button>
                          );
                        })}
                      </div>
                    )} />
                  </Field>
                </Grid>
              </Panel>
            </TabsContent>

            <TabsContent value="branding">
              <Panel>
                <Grid>
                  <ColorField label="Primary colour" name="primaryColor" register={register} value={values.primaryColor} error={errors.primaryColor?.message} />
                  <ColorField label="Secondary colour" name="secondaryColor" register={register} value={values.secondaryColor} error={errors.secondaryColor?.message} />
                </Grid>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ImageUpload label="Company logo" kind="logo" url={settings.companyLogoUrl} canManageSettings={canManageSettings} />
                  <ImageUpload label="Favicon" kind="favicon" url={settings.faviconUrl} canManageSettings={canManageSettings} />
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="sales">
              <Panel>
                <Grid>
                  <Field label="Booking prefix" error={errors.bookingPrefix?.message}><Input {...register('bookingPrefix')} /></Field>
                  <Field label="Quotation prefix" error={errors.quotationPrefix?.message}><Input {...register('quotationPrefix')} /></Field>
                  <Field label="Receipt prefix" error={errors.receiptPrefix?.message}><Input {...register('receiptPrefix')} /></Field>
                </Grid>
              </Panel>
            </TabsContent>

            <TabsContent value="invoice">
              <Panel>
                <Grid>
                  <Field label="Invoice prefix" error={errors.invoicePrefix?.message}><Input {...register('invoicePrefix')} /></Field>
                  <SwitchField control={control} name="gstEnabled" label="GST enabled" />
                  <Field label="GST number" error={errors.gstNumber?.message}><Input {...register('gstNumber')} disabled={!canManageSettings || !values.gstEnabled} /></Field>
                  <Field label="Tax percentage (%)" error={errors.taxPercentage?.message}><Input type="number" min={0} max={100} step={0.1} {...register('taxPercentage', { valueAsNumber: true })} /></Field>
                  <Field label="Terms & conditions" className="sm:col-span-2">
                    <div>
                      <Textarea rows={3} {...register('termsAndConditions')} />
                      <p className="mt-1 text-xs text-muted-foreground">Characters: {(values.termsAndConditions ?? '').length}</p>
                    </div>
                  </Field>
                  <Field label="Invoice footer" className="sm:col-span-2"><Input {...register('invoiceFooter')} /></Field>
                </Grid>
              </Panel>
            </TabsContent>

            <TabsContent value="service">
              <Panel>
                <Grid>
                  <Field label="Job card prefix" error={errors.jobCardPrefix?.message}><Input {...register('jobCardPrefix')} /></Field>
                  <Field label="Default warranty (months)" error={errors.defaultWarrantyMonths?.message}><Input type="number" min={0} {...register('defaultWarrantyMonths', { valueAsNumber: true })} /></Field>
                  <Field label="Service reminder (days)" error={errors.serviceReminderDays?.message}><Input type="number" min={0} {...register('serviceReminderDays', { valueAsNumber: true })} /></Field>
                </Grid>
                <p className="mt-5 mb-2 text-sm font-semibold">Free service intervals</p>
                <Grid>
                  <Field label="1st free service — km" error={errors.freeService1Km?.message}><Input type="number" min={0} {...register('freeService1Km', { valueAsNumber: true })} /></Field>
                  <Field label="1st free service — days" error={errors.freeService1Days?.message}><Input type="number" min={0} {...register('freeService1Days', { valueAsNumber: true })} /></Field>
                  <Field label="2nd free service — km" error={errors.freeService2Km?.message}><Input type="number" min={0} {...register('freeService2Km', { valueAsNumber: true })} /></Field>
                  <Field label="2nd free service — days" error={errors.freeService2Days?.message}><Input type="number" min={0} {...register('freeService2Days', { valueAsNumber: true })} /></Field>
                  <Field label="3rd free service — km" error={errors.freeService3Km?.message}><Input type="number" min={0} {...register('freeService3Km', { valueAsNumber: true })} /></Field>
                  <Field label="3rd free service — days" error={errors.freeService3Days?.message}><Input type="number" min={0} {...register('freeService3Days', { valueAsNumber: true })} /></Field>
                </Grid>
                <p className="mt-5 mb-2 text-sm font-semibold">Warranty &amp; AMC</p>
                <Grid>
                  <Field label="Warranty reminder (days before expiry)" error={errors.warrantyReminderDays?.message}><Input type="number" min={1} {...register('warrantyReminderDays', { valueAsNumber: true })} /></Field>
                </Grid>
                <div className="mt-3 space-y-1">
                  <SwitchRow control={control} name="warrantyEnabled" label="Warranty module" hint="Track warranties, coverage, claims and free services." />
                  <SwitchRow control={control} name="amcEnabled" label="AMC module" hint="Annual maintenance contracts and service visits." />
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="finance">
              <Panel>
                <Grid>
                  <Field label="Expense prefix" error={errors.expensePrefix?.message}><Input {...register('expensePrefix')} /></Field>
                  <Field label="Vendor prefix" error={errors.vendorPrefix?.message}><Input {...register('vendorPrefix')} /></Field>
                  <Field label="Income prefix" error={errors.incomePrefix?.message}><Input {...register('incomePrefix')} /></Field>
                  <Field label="Bank prefix" error={errors.bankPrefix?.message}><Input {...register('bankPrefix')} /></Field>
                  <Field label="Default GST rate (%)" error={errors.financeGstRate?.message}><Input type="number" min={0} step="0.01" {...register('financeGstRate', { valueAsNumber: true })} /></Field>
                  <Field label="Financial year start month" error={errors.financialYearStartMonth?.message}><Input type="number" min={1} max={12} {...register('financialYearStartMonth', { valueAsNumber: true })} /></Field>
                </Grid>
                <p className="mt-5 mb-2 text-sm font-semibold">Opening balances &amp; alerts (₹)</p>
                <Grid>
                  <Field label="Opening cash" error={errors.openingCash?.message}><Input type="number" min={0} {...register('openingCash', { setValueAs: (v) => Math.round(Number(v) * 100) })} /></Field>
                  <Field label="Opening bank" error={errors.openingBank?.message}><Input type="number" min={0} {...register('openingBank', { setValueAs: (v) => Math.round(Number(v) * 100) })} /></Field>
                  <Field label="Low-cash alert below" error={errors.lowCashThreshold?.message}><Input type="number" min={0} {...register('lowCashThreshold', { setValueAs: (v) => Math.round(Number(v) * 100) })} /></Field>
                  <Field label="Large-expense alert above" error={errors.largeExpenseThreshold?.message}><Input type="number" min={0} {...register('largeExpenseThreshold', { setValueAs: (v) => Math.round(Number(v) * 100) })} /></Field>
                </Grid>
                <div className="mt-3 space-y-1">
                  <SwitchRow control={control} name="financeEnabled" label="Finance module" hint="Expenses, income, vendors, cash book and P&L." />
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="notifications">
              <Panel>
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">In-app categories</p>
                  <SwitchRow control={control} name="notifyDelivery" label="Delivery notifications" />
                  <SwitchRow control={control} name="notifyPayment" label="Payment notifications" />
                  <SwitchRow control={control} name="notifyService" label="Service notifications" />
                  <SwitchRow control={control} name="notifyInventory" label="Inventory notifications" />
                  <SwitchRow control={control} name="notifyWarranty" label="Warranty notifications" />
                  <SwitchRow control={control} name="desktopNotifications" label="Desktop notifications" hint="Show the notification bell + badge in the top bar." />
                  <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Channels (future-ready)</p>
                  <SwitchRow control={control} name="emailEnabled" label="Email notifications" hint="Channel wiring is future-ready." />
                  <SwitchRow control={control} name="smsEnabled" label="SMS notifications" />
                  <SwitchRow control={control} name="whatsappEnabled" label="WhatsApp notifications" />
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="localization">
              <Panel>
                <Grid>
                  <SelectField control={control} name="currency" label="Currency" options={CURRENCIES} />
                  <Field label="Timezone"><Input {...register('timezone')} /></Field>
                  <SelectField control={control} name="language" label="Language" options={LANGUAGES} />
                  <SelectField control={control} name="dateFormat" label="Date format" options={DATE_FORMATS} />
                  <SelectField control={control} name="timeFormat" label="Time format" options={TIME_FORMATS} />
                </Grid>
              </Panel>
            </TabsContent>

            <TabsContent value="backup">
              <Panel>
                <div className="space-y-4">
                  <SwitchRow control={control} name="backupEnabled" label="Automatic backup" hint="Scheduled SQL backups (execution is future-ready)." />
                  <div className="max-w-xs"><SelectField control={control} name="backupFrequency" label="Backup frequency" options={BACKUP_FREQUENCIES} format={titleCase} /></div>
                </div>
              </Panel>
            </TabsContent>
          </Tabs>
        </fieldset>

        {canManageSettings && isDirty && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-3 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between">
              <span className="text-sm text-amber-600">You have unsaved changes.</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => reset()}>Discard</Button>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </div>
          </div>
        )}
      </form>

      <Dialog open={blocker.state === 'blocked'} onOpenChange={(o) => { if (!o) blocker.reset?.(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">You have unsaved settings. Leave without saving?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>Stay</Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }): JSX.Element {
  return <Card><CardContent className="p-6">{children}</CardContent></Card>;
}
function Grid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}
function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }): JSX.Element {
  return <div className={`space-y-1.5 ${className ?? ''}`}><Label>{label}</Label>{children}{error && <p className="text-xs text-destructive">{error}</p>}</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ColorField({ label, name, register, value, error }: { label: string; name: string; register: any; value?: string; error?: string }): JSX.Element {
  return (
    <Field label={label} error={error}>
      <div className="flex items-center gap-2">
        <input type="color" className="h-9 w-12 cursor-pointer rounded border" {...register(name)} />
        <Input {...register(name)} value={value ?? ''} readOnly className="font-mono" />
      </div>
    </Field>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SwitchField({ control, name, label }: { control: any; name: string; label: string }): JSX.Element {
  return (
    <Field label={label}>
      <Controller control={control} name={name} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
    </Field>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SwitchRow({ control, name, label, hint }: { control: any; name: string; label: string; hint?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <Controller control={control} name={name} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
    </div>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SelectField({ control, name, label, options, format }: { control: any; name: string; label: string; options: readonly string[]; format?: (s: string) => string }): JSX.Element {
  return (
    <Field label={label}>
      <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value ?? ''} onValueChange={field.onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{format ? format(o) : o}</SelectItem>)}</SelectContent>
        </Select>
      )} />
    </Field>
  );
}

function ImageUpload({ label, kind, url, canManageSettings }: { label: string; kind: 'logo' | 'favicon'; url: string | null; canManageSettings: boolean }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(url);
  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try { const s = await settingsApi.uploadImage(kind, file); setCurrent(kind === 'logo' ? s.companyLogoUrl : s.faviconUrl); toast.success(`${label} updated`); }
    catch (e) { toast.error(apiErrorMessage(e)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const remove = async (): Promise<void> => { await settingsApi.removeImage(kind); setCurrent(null); };
  const src = current ? (current.startsWith('http') ? current : `${API_ORIGIN}${current}`) : null;
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {src ? <img src={src} alt={label} className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
        </div>
        {canManageSettings && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>Upload</Button>
            {src && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}
