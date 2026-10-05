import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GST_ADJUSTMENT_TREATMENTS, type GstAdjustmentTreatment, type TaxClassificationDto, type TaxMappedComponent } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { gstAdjustmentTreatmentLabel, taxComponentLabel } from '@/lib/labels';
import { useAuth } from '@/features/auth/auth-context';
import { useCompanySettings, useUpdateSettings } from '@/features/settings/hooks';
import { useModels } from '@/features/inventory/hooks';
import { useAccessories } from '@/features/sales/hooks';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useComponentMappings, useGstConfigMutations } from '../hooks';
import { ClassificationSelect } from './classification-select';

const NOT_CONFIGURED = '__none__';
const loading = <Card><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>;

// ── Discount / exchange policy ─────────────────────────────
function TreatmentSelect({ name, label, value, disabled, onChange }: { name: string; label: string; value: GstAdjustmentTreatment | null; disabled: boolean; onChange: (v: GstAdjustmentTreatment | null) => void }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select name={name} value={value ?? NOT_CONFIGURED} disabled={disabled} onValueChange={(v) => onChange(v === NOT_CONFIGURED ? null : (v as GstAdjustmentTreatment))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NOT_CONFIGURED}>Not configured</SelectItem>
          {GST_ADJUSTMENT_TREATMENTS.map((t) => <SelectItem key={t} value={t}>{gstAdjustmentTreatmentLabel(t)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * How GST treats a booking's discount and exchange value. There is deliberately NO default: until a
 * treatment is chosen, a GST invoice carrying that amount is refused.
 */
export function GstPolicyCard({ canManage }: { canManage: boolean }): JSX.Element {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useCompanySettings();
  const update = useUpdateSettings();
  if (isLoading || !settings) return loading;

  const save = async (patch: { gstDiscountTreatment?: GstAdjustmentTreatment | null; gstExchangeTreatment?: GstAdjustmentTreatment | null }): Promise<void> => {
    try {
      await update.mutateAsync(patch);
      void qc.invalidateQueries({ queryKey: ['tax', 'readiness'] });
      toast.success('GST policy saved');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the GST policy'));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Discount &amp; exchange treatment</h2>
          <p className="text-xs text-muted-foreground">
            Set these as advised by your accountant. Nothing is assumed: while a treatment is not configured, a GST invoice that carries a discount or an exchange value cannot be generated.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TreatmentSelect name="discount-treatment" label="Discount treatment" value={settings.gstDiscountTreatment} disabled={!canManage || update.isPending} onChange={(v) => void save({ gstDiscountTreatment: v })} />
          <TreatmentSelect name="exchange-treatment" label="Exchange treatment" value={settings.gstExchangeTreatment} disabled={!canManage || update.isPending} onChange={(v) => void save({ gstExchangeTreatment: v })} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Component mappings ─────────────────────────────────────
/** Which classification each scalar booking component uses. Changes apply to future invoices only. */
export function ComponentMappingCard({ canManage, classifications }: { canManage: boolean; classifications: TaxClassificationDto[] }): JSX.Element {
  const { data: mappings, isLoading } = useComponentMappings();
  const { setComponentMapping, clearComponentMapping } = useGstConfigMutations();
  if (isLoading || !mappings) return loading;

  const change = async (component: TaxMappedComponent, classificationId: string | null): Promise<void> => {
    try {
      if (classificationId === null) await clearComponentMapping.mutateAsync(component);
      else await setComponentMapping.mutateAsync({ component, classificationId });
      toast.success(`${taxComponentLabel(component)} mapping ${classificationId === null ? 'cleared' : 'saved'}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the mapping'));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Component tax mapping</h2>
          <p className="text-xs text-muted-foreground">
            The classification decides how each component is treated. A mapping is needed only for components your sales actually include, and a change affects future invoices only.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Component</th><th className="pb-2 font-medium">Classification</th></tr></thead>
          <tbody className="divide-y">
            {mappings.map((m) => (
              <tr key={m.component}>
                <td className="py-2 pr-4 font-medium">{taxComponentLabel(m.component)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClassificationSelect
                      name={`mapping-${m.component}`}
                      value={m.classification?.id ?? null}
                      current={m.classification}
                      options={classifications}
                      noneLabel="Not mapped"
                      disabled={!canManage || setComponentMapping.isPending || clearComponentMapping.isPending}
                      onChange={(id) => void change(m.component, id)}
                    />
                    {m.classification && !m.usable && <Badge variant="warning">Inactive classification</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Product defaults ───────────────────────────────────────
function ProductRows<T extends { id: string; name: string; taxClassificationId?: string | null }>({
  kind,
  rows,
  secondary,
  classifications,
  canEdit,
  busy,
  onChange,
}: {
  kind: string;
  rows: T[];
  secondary?: (row: T) => string | undefined;
  classifications: TaxClassificationDto[];
  canEdit: boolean;
  busy: boolean;
  onChange: (row: T, classificationId: string | null) => void;
}): JSX.Element {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span><span className="font-medium">{row.name}</span>{secondary?.(row) ? <span className="ml-2 text-xs text-muted-foreground">{secondary(row)}</span> : null}</span>
          <ClassificationSelect name={`${kind}-${row.id}`} value={row.taxClassificationId ?? null} options={classifications} noneLabel="Not classified" disabled={!canEdit || busy} onChange={(id) => onChange(row, id)} />
        </li>
      ))}
    </ul>
  );
}

function ModelDefaults({ classifications, canEdit }: { classifications: TaxClassificationDto[]; canEdit: boolean }): JSX.Element {
  const { data: models, isLoading } = useModels();
  const { setScooterModelClassification } = useGstConfigMutations();
  if (isLoading || !models) return <Skeleton className="h-12 w-full" />;
  const change = async (modelId: string, name: string, taxClassificationId: string | null): Promise<void> => {
    try {
      await setScooterModelClassification.mutateAsync({ modelId, taxClassificationId });
      toast.success(`${name}: classification ${taxClassificationId === null ? 'cleared' : 'saved'}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the classification'));
    }
  };
  return <ProductRows kind="model" rows={models} secondary={(m) => m.brand} classifications={classifications} canEdit={canEdit} busy={setScooterModelClassification.isPending} onChange={(m, id) => void change(m.id, m.name, id)} />;
}

function AccessoryDefaults({ classifications, canEdit }: { classifications: TaxClassificationDto[]; canEdit: boolean }): JSX.Element {
  const { data: accessories, isLoading } = useAccessories();
  const { setAccessoryClassification } = useGstConfigMutations();
  if (isLoading || !accessories) return <Skeleton className="h-12 w-full" />;
  const change = async (accessoryId: string, name: string, taxClassificationId: string | null): Promise<void> => {
    try {
      await setAccessoryClassification.mutateAsync({ accessoryId, taxClassificationId });
      toast.success(`${name}: classification ${taxClassificationId === null ? 'cleared' : 'saved'}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the classification'));
    }
  };
  return <ProductRows kind="accessory" rows={accessories} classifications={classifications} canEdit={canEdit} busy={setAccessoryClassification.isPending} onChange={(a, id) => void change(a.id, a.name, id)} />;
}

/**
 * Scooter model / accessory → tax classification. Each list needs that product's own view permission
 * and each edit its own manage permission — holding the GST settings permission does not grant either.
 */
export function ProductDefaultsCard({ classifications }: { classifications: TaxClassificationDto[] }): JSX.Element | null {
  const { can } = useAuth();
  const showModels = can('inventory.view');
  const showAccessories = can('accessories.view');
  if (!showModels && !showAccessories) return null;
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div>
          <h2 className="text-base font-semibold">Product defaults</h2>
          <p className="text-xs text-muted-foreground">Which classification each product uses on future invoices. Nothing is assigned automatically; rates are managed on the classification.</p>
        </div>
        {showModels && (
          <section aria-label="Scooter models">
            <h3 className="mb-1 text-sm font-semibold">Scooter models</h3>
            <ModelDefaults classifications={classifications} canEdit={can('inventory.update')} />
          </section>
        )}
        {showAccessories && (
          <section aria-label="Accessories">
            <h3 className="mb-1 text-sm font-semibold">Accessories</h3>
            <AccessoryDefaults classifications={classifications} canEdit={can('accessories.manage')} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
