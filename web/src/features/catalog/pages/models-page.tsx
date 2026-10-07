import { useMemo, useState } from 'react';
import { Layers, MoreHorizontal, Pencil, Plus, Power, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogModelDto, CatalogStatusFilter } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCatalogModels, useCatalogMutations } from '../hooks';
import { GstClassificationBadge, useClassificationLookup } from '../components/gst-classification';
import { ModelFormDialog } from '../components/model-form-dialog';
import { ModelDetailDialog } from '../components/model-detail-dialog';

const STATUS_LABEL: Record<CatalogStatusFilter, string> = { active: 'Active', inactive: 'Inactive', all: 'All' };

/**
 * Inventory → Models: the curated catalogue. Reads need inventory.view, adding needs inventory.create,
 * editing and activation need inventory.update — each checked on its own. GST is shown read-only;
 * it is changed on Settings → GST Management.
 */
export function ModelsPage(): JSX.Element {
  const { can } = useAuth();
  const canView = can('inventory.view');
  const canCreate = can('inventory.create');
  const canUpdate = can('inventory.update');

  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const query = useMemo(() => ({ q: q.trim() || undefined, status }), [q, status]);
  const { data, isLoading, isFetching } = useCatalogModels(query, canView);
  const lookup = useClassificationLookup(canView);
  const { setModelActive } = useCatalogMutations();

  const [form, setForm] = useState<{ model?: CatalogModelDto } | null>(null);
  const [toggle, setToggle] = useState<CatalogModelDto | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!canView) {
    return <EmptyState icon={Layers} title="Models" description="You don’t have permission to view the catalogue." />;
  }

  const confirmToggle = async (): Promise<void> => {
    if (!toggle) return;
    try {
      await setModelActive.mutateAsync({ id: toggle.id, isActive: !toggle.isActive });
      toast.success(toggle.isActive ? `Deactivated ${toggle.brand} ${toggle.name}` : `Activated ${toggle.brand} ${toggle.name}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not change the model status'));
    }
  };

  const columns: Column<CatalogModelDto>[] = [
    { key: 'brand', header: 'Brand', render: (m) => m.brand },
    { key: 'name', header: 'Model', render: (m) => <div><p className="font-medium">{m.name}</p>{m.description && <p className="max-w-xs truncate text-xs text-muted-foreground">{m.description}</p>}</div> },
    { key: 'variants', header: 'Variants', align: 'right', render: (m) => <span className="tabular-nums">{m.variantCount ?? 0}</span> },
    { key: 'units', header: 'Units', align: 'right', render: (m) => <span className="tabular-nums">{m.unitCount ?? 0}</span> },
    { key: 'gst', header: 'GST', render: (m) => <GstClassificationBadge id={m.taxClassificationId} lookup={lookup} /> },
    { key: 'status', header: 'Status', render: (m) => <Badge variant={m.isActive ? 'success' : 'muted'}>{m.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (m) =>
        canUpdate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${m.brand} ${m.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => setForm({ model: m })}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setToggle(m)}><Power className="h-4 w-4" /> {m.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  const filtering = Boolean(query.q) || status !== 'active';

  return (
    <div>
      <PageHeader
        title="Models"
        description="The scooter models and variants you sell. Stock, quotations and bookings pick from the active ones."
        actions={canCreate && <Button onClick={() => setForm({})}><Plus className="h-4 w-4" /> Add model</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search brand or model…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search models" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as CatalogStatusFilter)}>
          <SelectTrigger className="sm:w-40" aria-label="Status filter"><SelectValue /></SelectTrigger>
          <SelectContent>{(['active', 'inactive', 'all'] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data ?? []}
        getRowId={(m) => m.id}
        loading={isLoading || isFetching}
        onRowClick={(m) => setOpenId(m.id)}
        emptyState={
          filtering ? (
            <EmptyState icon={Layers} title="No models match" description="Try another search or status." />
          ) : (
            <EmptyState
              icon={Layers}
              title="No models yet"
              description={canCreate ? 'Add the first model to start building the catalogue.' : 'Models will appear here once they are added.'}
              action={canCreate ? <Button onClick={() => setForm({})}><Plus className="h-4 w-4" /> Add model</Button> : undefined}
            />
          )
        }
      />

      {form && <ModelFormDialog open onOpenChange={() => setForm(null)} model={form.model} />}
      <ConfirmDialog
        open={Boolean(toggle)}
        onOpenChange={(o) => { if (!o) setToggle(null); }}
        title={toggle ? `${toggle.isActive ? 'Deactivate' : 'Activate'} ${toggle.brand} ${toggle.name}?` : ''}
        description={toggle?.isActive
          ? 'The model will no longer appear when adding stock, quotations or bookings. Existing scooters, bookings, sales and documents keep referring to it. Its variants are NOT deactivated — manage them separately.'
          : 'The model becomes available again for new stock and sales. Its variants keep their own active or inactive state.'}
        confirmLabel={toggle?.isActive ? 'Deactivate' : 'Activate'}
        destructive={Boolean(toggle?.isActive)}
        onConfirm={confirmToggle}
      />
      <ModelDetailDialog id={openId} onOpenChange={(o) => { if (!o) setOpenId(null); }} />
    </div>
  );
}
