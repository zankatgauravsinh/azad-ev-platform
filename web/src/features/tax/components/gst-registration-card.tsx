import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { toast } from 'sonner';
import { gstActivationBlockers, type GstReadinessDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { gstAdjustmentTreatmentLabel, taxComponentLabel } from '@/lib/labels';
import { useCompanySettings, useUpdateSettings } from '@/features/settings/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGstReadiness } from '../hooks';

/**
 * Company GST registration: the enable switch, GSTIN and state code. The backend decides whether GST
 * may be enabled; the checks here only explain why a save would be refused.
 */
export function GstRegistrationCard({ canManage }: { canManage: boolean }): JSX.Element {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useCompanySettings();
  const update = useUpdateSettings();
  const [enabled, setEnabled] = useState(false);
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.gstEnabled);
    setGstin(settings.gstNumber ?? '');
    setStateCode(settings.gstStateCode ?? '');
  }, [settings]);

  if (isLoading || !settings) return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;

  const normalizedGstin = gstin.trim().toUpperCase();
  const normalizedState = stateCode.trim();
  const blockers = enabled ? gstActivationBlockers({ gstNumber: normalizedGstin, gstStateCode: normalizedState }) : [];
  const dirty = enabled !== settings.gstEnabled || normalizedGstin !== (settings.gstNumber ?? '') || normalizedState !== (settings.gstStateCode ?? '');

  const save = async (): Promise<void> => {
    try {
      await update.mutateAsync({ gstEnabled: enabled, gstNumber: normalizedGstin, gstStateCode: normalizedState });
      void qc.invalidateQueries({ queryKey: ['tax', 'readiness'] });
      toast.success(enabled ? 'GST registration saved — GST is enabled' : 'GST registration saved');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save GST registration'));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">GST registration</h2>
          <Badge variant={settings.gstEnabled ? 'success' : 'muted'}>{settings.gstEnabled ? 'GST enabled' : 'GST disabled'}</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" aria-label="GST enabled" checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />
            Calculate GST on new invoices
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gstin">GSTIN</Label>
            <Input id="gstin" autoComplete="off" maxLength={15} value={gstin} disabled={!canManage} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="15-character GSTIN" />
            <p className="text-xs text-muted-foreground">Format check only — the number is not verified with the GST portal.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gst-state-code">GST state code</Label>
            <Input id="gst-state-code" autoComplete="off" inputMode="numeric" maxLength={2} value={stateCode} disabled={!canManage} onChange={(e) => setStateCode(e.target.value)} placeholder="Two digits" />
          </div>
        </div>
        {blockers.length > 0 && (
          <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            {blockers.map((b) => <li key={b}>GST cannot be enabled: {b}</li>)}
          </ul>
        )}
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={!dirty || blockers.length > 0 || update.isPending}>Save registration</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }): JSX.Element {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span><span className="font-medium">{label}</span> <span className="text-muted-foreground">— {detail ?? (ok ? 'Configured' : 'Not configured')}</span></span>
    </li>
  );
}

const counts = (c: GstReadinessDto['scooterModels'], noun: string): string =>
  c.total === 0 ? `No ${noun} yet` : `${c.total} ${noun} · ${c.classified} classified · ${c.missing} missing`;

/**
 * Informational summary. It is not an enforcement point — invoice generation is — so an unmapped
 * component or an unclassified product is shown plainly rather than as an error.
 */
export function GstReadinessCard(): JSX.Element {
  const { data: r, isLoading } = useGstReadiness();
  if (isLoading || !r) return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-base font-semibold">Configuration readiness</h2>
        <p className="text-xs text-muted-foreground">
          A guide only. Each invoice is checked when it is generated: a component or product is needed only by the sales that actually use it.
        </p>
        <ul className="space-y-1.5">
          <Check ok={r.registration.gstinWellFormed} label="Company GST registration" detail={r.registration.gstinPresent && !r.registration.gstinWellFormed ? 'GSTIN is not well-formed' : undefined} />
          <Check ok={r.registration.stateCodeValid && r.registration.stateCodeMatchesGstin !== false} label="Company state" detail={r.registration.stateCodeMatchesGstin === false ? 'Does not match the GSTIN' : undefined} />
          <Check ok={r.discountTreatment !== null} label="Discount policy" detail={r.discountTreatment ? gstAdjustmentTreatmentLabel(r.discountTreatment) : undefined} />
          <Check ok={r.exchangeTreatment !== null} label="Exchange policy" detail={r.exchangeTreatment ? gstAdjustmentTreatmentLabel(r.exchangeTreatment) : undefined} />
          {r.componentMappings.map((m) => (
            <Check key={m.component} ok={m.usable} label={`${taxComponentLabel(m.component)} mapping`} detail={m.classification ? (m.usable ? m.classification.name : `${m.classification.name} (inactive)`) : 'Not mapped'} />
          ))}
        </ul>
        <dl className="grid gap-1 border-t pt-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Scooter models</dt><dd>{counts(r.scooterModels, 'scooter models')}</dd></div>
          <div><dt className="text-muted-foreground">Accessories</dt><dd>{counts(r.accessories, 'accessories')}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Tax classifications</dt>
            <dd>{r.classifications.active} active{r.classifications.taxableWithoutCurrentRate > 0 ? ` · ${r.classifications.taxableWithoutCurrentRate} taxable without a rate for today` : ''}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
