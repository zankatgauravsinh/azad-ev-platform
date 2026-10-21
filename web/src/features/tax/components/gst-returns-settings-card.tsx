import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { useCompanySettings, useUpdateSettings } from '@/features/settings/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

interface Values { effectiveFrom: string; aatoAbove5Cr: boolean; sac: string; partsHsn: string; serviceRate: string }

/**
 * What the GST returns and service bills need besides the registration: the date GST registration took effect
 * (invoices before it never carry GST), the turnover band that sets the HSN digits in GSTR-1, and the SAC / HSN
 * and default rate printed on service bills.
 */
export function GstReturnsSettingsCard({ canManage }: { canManage: boolean }): JSX.Element {
  const { data: settings, isLoading } = useCompanySettings();
  const update = useUpdateSettings();
  const [v, setV] = useState<Values>({ effectiveFrom: '', aatoAbove5Cr: false, sac: '', partsHsn: '', serviceRate: '18' });
  useEffect(() => {
    if (!settings) return;
    setV({
      effectiveFrom: settings.gstEffectiveFrom ?? '',
      aatoAbove5Cr: settings.gstAatoAbove5Cr,
      sac: settings.serviceSacCode ?? '',
      partsHsn: settings.servicePartsHsnCode ?? '',
      serviceRate: String(settings.serviceGstRateBp / 100),
    });
  }, [settings]);

  if (isLoading || !settings) return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;

  const set = <K extends keyof Values>(k: K, value: Values[K]): void => setV((p) => ({ ...p, [k]: value }));
  const save = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        gstEffectiveFrom: v.effectiveFrom,
        gstAatoAbove5Cr: v.aatoAbove5Cr,
        serviceSacCode: v.sac.trim(),
        servicePartsHsnCode: v.partsHsn.trim(),
        serviceGstRateBp: Math.round(Number(v.serviceRate || 0) * 100),
      });
      toast.success('GST return settings saved');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save GST return settings'));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-base font-semibold">GST returns &amp; service bills</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gst-effective-from">GST registration effective from</Label>
            <Input id="gst-effective-from" type="date" value={v.effectiveFrom} disabled={!canManage} onChange={(e) => set('effectiveFrom', e.target.value)} />
            <p className="text-xs text-muted-foreground">Invoices dated before this carry no GST.</p>
          </div>
          <label className="flex items-start gap-2 pt-6 text-sm">
            <input type="checkbox" aria-label="Turnover above 5 crore" checked={v.aatoAbove5Cr} disabled={!canManage} onChange={(e) => set('aatoAbove5Cr', e.target.checked)} />
            <span>Previous year turnover above ₹5 crore <span className="block text-xs text-muted-foreground">GSTR-1 HSN summary uses 6 digits (else 4).</span></span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="service-sac">Service labour SAC</Label>
            <Input id="service-sac" inputMode="numeric" maxLength={8} value={v.sac} disabled={!canManage} onChange={(e) => set('sac', e.target.value)} placeholder="9987" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-hsn">Spare parts HSN</Label>
            <Input id="service-hsn" inputMode="numeric" maxLength={8} value={v.partsHsn} disabled={!canManage} onChange={(e) => set('partsHsn', e.target.value)} placeholder="e.g. 8714" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-rate">Default GST on service bills (%)</Label>
            <Input id="service-rate" type="number" min={0} max={28} step="0.01" value={v.serviceRate} disabled={!canManage} onChange={(e) => set('serviceRate', e.target.value)} />
          </div>
        </div>
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={update.isPending}>Save</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
