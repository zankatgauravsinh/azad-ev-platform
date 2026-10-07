import { useState } from 'react';
import { MoreHorizontal, Pencil, Plus, Power } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogStatusFilter, CatalogVariantDto } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCatalogModel, useCatalogMutations, useCatalogVariants } from '../hooks';
import { GstClassificationCard, useClassificationLookup } from './gst-classification';
import { ModelFormDialog } from './model-form-dialog';
import { VariantFormDialog } from './variant-form-dialog';

const STATUS_LABEL: Record<CatalogStatusFilter, string> = { active: 'Active', inactive: 'Inactive', all: 'All' };

/** A model with its variants. Variants are fetched only while this dialog is open. */
export function ModelDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { can } = useAuth();
  const canCreate = can('inventory.create');
  const canUpdate = can('inventory.update');
  const { data: model } = useCatalogModel(id);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const { data: variants, isLoading, isFetching } = useCatalogVariants(id, status);
  const lookup = useClassificationLookup(Boolean(id));
  const { setModelActive, setVariantActive } = useCatalogMutations();

  const [editModel, setEditModel] = useState(false);
  const [modelToggle, setModelToggle] = useState(false);
  const [variantForm, setVariantForm] = useState<{ variant?: CatalogVariantDto } | null>(null);
  const [variantToggle, setVariantToggle] = useState<CatalogVariantDto | null>(null);

  const label = model ? `${model.brand} ${model.name}` : '';

  const toggleModel = async (): Promise<void> => {
    if (!model) return;
    try {
      await setModelActive.mutateAsync({ id: model.id, isActive: !model.isActive });
      toast.success(model.isActive ? 'Model deactivated' : 'Model activated');
    } catch (e) { toast.error(apiErrorMessage(e, 'Could not change the model status')); }
  };
  const toggleVariant = async (): Promise<void> => {
    if (!variantToggle) return;
    try {
      await setVariantActive.mutateAsync({ id: variantToggle.id, isActive: !variantToggle.isActive });
      toast.success(variantToggle.isActive ? 'Variant deactivated' : 'Variant activated');
    } catch (e) { toast.error(apiErrorMessage(e, 'Could not change the variant status')); }
  };

  const columns: Column<CatalogVariantDto>[] = [
    { key: 'name', header: 'Variant', render: (v) => <span className="font-medium">{v.name}</span> },
    { key: 'colour', header: 'Colour', render: (v) => <span className="inline-flex items-center gap-2">{v.hexColour && <span aria-hidden className="h-3.5 w-3.5 rounded-full border" style={{ backgroundColor: v.hexColour }} />}{v.colour}</span> },
    { key: 'price', header: 'List price', align: 'right', render: (v) => <span className="tabular-nums">{formatPaise(v.exShowroomPrice)}</span> },
    { key: 'range', header: 'Range', align: 'right', render: (v) => (v.rangeKm != null ? `${v.rangeKm} km` : '—') },
    { key: 'motor', header: 'Motor', align: 'right', render: (v) => (v.motorPowerW != null ? `${v.motorPowerW} W` : '—') },
    { key: 'units', header: 'Units', align: 'right', render: (v) => <span className="tabular-nums">{v.unitCount ?? 0}</span> },
    { key: 'status', header: 'Status', render: (v) => <Badge variant={v.isActive ? 'success' : 'muted'}>{v.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (v) =>
        canUpdate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${v.name} ${v.colour}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setVariantForm({ variant: v })}><Pencil className="h-4 w-4" /> Edit variant</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVariantToggle(v)}><Power className="h-4 w-4" /> {v.isActive ? 'Deactivate variant' : 'Activate variant'}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto">
        {!model ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{label}</span>
                <Badge variant={model.isActive ? 'success' : 'muted'}>{model.isActive ? 'Active' : 'Inactive'}</Badge>
                {canUpdate && (
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditModel(true)}><Pencil className="h-4 w-4" /> Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setModelToggle(true)}><Power className="h-4 w-4" /> {model.isActive ? 'Deactivate' : 'Activate'}</Button>
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>{model.description || 'No description.'}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <Field label="Brand" value={model.brand} />
              <Field label="Model" value={model.name} />
              <Field label="Variants" value={String(model.variantCount ?? 0)} />
              <Field label="Units in stock" value={String(model.unitCount ?? 0)} />
            </dl>

            <GstClassificationCard id={model.taxClassificationId} lookup={lookup} />

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-accent">Variants</h3>
                <Select value={status} onValueChange={(v) => setStatus(v as CatalogStatusFilter)}>
                  <SelectTrigger className="h-8 w-32" aria-label="Variant status"><SelectValue /></SelectTrigger>
                  <SelectContent>{(['active', 'inactive', 'all'] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
                {canCreate && (
                  <Button size="sm" className="ml-auto" disabled={!model.isActive} title={model.isActive ? undefined : 'Activate the model to add variants'} onClick={() => setVariantForm({})}>
                    <Plus className="h-4 w-4" /> Add variant
                  </Button>
                )}
              </div>
              <DataTable
                columns={columns}
                rows={variants ?? []}
                getRowId={(v) => v.id}
                loading={isLoading || isFetching}
                emptyState={
                  <EmptyState
                    title="No variants yet"
                    description={status === 'active' ? 'Add the trims and colours you stock for this model.' : 'No variants match this filter.'}
                    action={canCreate && model.isActive && status === 'active' ? <Button size="sm" onClick={() => setVariantForm({})}><Plus className="h-4 w-4" /> Add variant</Button> : undefined}
                  />
                }
              />
            </section>

            <ModelFormDialog open={editModel} onOpenChange={setEditModel} model={model} />
            <ConfirmDialog
              open={modelToggle}
              onOpenChange={setModelToggle}
              title={model.isActive ? `Deactivate ${label}?` : `Activate ${label}?`}
              description={model.isActive
                ? 'The model will no longer appear when adding stock, quotations or bookings. Existing scooters, bookings, sales and documents keep referring to it. Its variants are NOT deactivated — manage them separately.'
                : 'The model becomes available again for new stock and sales. Its variants keep their own active or inactive state.'}
              confirmLabel={model.isActive ? 'Deactivate' : 'Activate'}
              destructive={model.isActive}
              onConfirm={toggleModel}
            />
            {variantForm && <VariantFormDialog open onOpenChange={() => setVariantForm(null)} modelId={model.id} modelLabel={label} variant={variantForm.variant} />}
            <ConfirmDialog
              open={Boolean(variantToggle)}
              onOpenChange={(o) => { if (!o) setVariantToggle(null); }}
              title={variantToggle ? `${variantToggle.isActive ? 'Deactivate' : 'Activate'} ${variantToggle.name} · ${variantToggle.colour}?` : ''}
              description={variantToggle?.isActive
                ? 'The variant will no longer appear when adding stock, quotations or bookings. Existing scooters and records keep referring to it. The model is not affected.'
                : 'The variant becomes available again for new stock and sales. The model is not affected.'}
              confirmLabel={variantToggle?.isActive ? 'Deactivate' : 'Activate'}
              destructive={Boolean(variantToggle?.isActive)}
              onConfirm={toggleVariant}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
