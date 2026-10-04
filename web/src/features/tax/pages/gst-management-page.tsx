import { useMemo, useState } from 'react';
import { ArrowLeft, MoreHorizontal, Pencil, Percent, Plus, Receipt, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { TaxClassificationDto } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTaxClassifications, useTaxMutations } from '../hooks';
import { ClassificationFormDialog } from '../components/classification-form-dialog';
import { RatesDialog } from '../components/rates-dialog';

/** Current (open-ended or latest active) rate for display only. */
const currentRate = (c: TaxClassificationDto): string | null => {
  const active = c.rates.filter((r) => r.isActive);
  if (active.length === 0) return null;
  const open = active.find((r) => r.effectiveTo === null);
  const pick = open ?? [...active].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]!;
  return `${pick.ratePercent}%`;
};

export function GstManagementPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canView = can('settings.view');
  const canManage = can('settings.manage');

  const [formFor, setFormFor] = useState<{ classification?: TaxClassificationDto } | null>(null);
  const [ratesForId, setRatesForId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxClassificationDto | undefined>();

  const { data, isLoading, isFetching } = useTaxClassifications(false, canView);
  const { removeClassification } = useTaxMutations();
  // Keep the open Rates dialog in sync with refetched data.
  const ratesFor = useMemo(() => data?.find((c) => c.id === ratesForId) ?? null, [data, ratesForId]);

  if (!canView) {
    return <EmptyState icon={Receipt} title="GST Management" description="You don’t have permission to view GST settings." />;
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await removeClassification.mutateAsync(deleteTarget.id);
      toast.success(`Archived ${deleteTarget.name}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not archive the classification'));
    }
  };

  const columns: Column<TaxClassificationDto>[] = [
    { key: 'name', header: 'Classification', render: (c) => <div><p className="font-medium">{c.name}</p>{c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}</div> },
    { key: 'code', header: 'HSN / SAC', render: (c) => <span className="font-mono text-xs">{c.codeType}{c.code ? ` · ${c.code}` : ''}</span> },
    { key: 'treatment', header: 'Treatment', render: (c) => <Badge variant={c.treatment === 'TAXABLE' ? 'accent' : 'muted'}>{titleCase(c.treatment)}</Badge> },
    { key: 'rate', header: 'Current rate', align: 'right', render: (c) => <span className="tabular-nums">{currentRate(c) ?? '—'}</span> },
    {
      key: 'actions', header: '', align: 'right',
      render: (c) =>
        canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => setFormFor({ classification: c })}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRatesForId(c.id)}><Percent className="h-4 w-4" /> Manage rates</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(c)}><Trash2 className="h-4 w-4" /> Archive</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div>
      <button type="button" onClick={() => navigate('/settings')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to settings</button>
      <PageHeader
        title="GST Management"
        description="Tax classifications (HSN/SAC) and effective-dated rates. Configuration only — this does not calculate GST on sales yet."
        actions={canManage ? <Button onClick={() => setFormFor({})}><Plus className="h-4 w-4" /> New classification</Button> : undefined}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        getRowId={(c) => c.id}
        loading={isLoading || isFetching}
        onRowClick={canManage ? (c) => setRatesForId(c.id) : undefined}
        emptyState={<EmptyState icon={Receipt} title="No tax classifications" description={canManage ? 'Create a classification (e.g. Electric two-wheeler) to get started.' : 'None configured yet.'} />}
      />

      <ClassificationFormDialog open={formFor !== null} onOpenChange={(o) => { if (!o) setFormFor(null); }} classification={formFor?.classification} />
      <RatesDialog open={ratesForId !== null} onOpenChange={(o) => { if (!o) setRatesForId(null); }} classification={ratesFor} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(undefined)}
        title={`Archive ${deleteTarget?.name}?`}
        description="It will be hidden from the active list. Historical configuration is preserved."
        confirmLabel="Archive"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
