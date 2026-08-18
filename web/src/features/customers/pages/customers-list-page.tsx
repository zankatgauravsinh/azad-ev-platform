import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { LEAD_STATUSES, LeadStatus, type CustomerListItem, type ListCustomersQuery } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { leadStatusLabel } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCustomerList, useCustomerStats, useDeleteCustomer } from '../hooks';
import { LeadStatusBadge } from '../components/lead-status-badge';
import { CustomerFormDialog } from '../components/customer-form-dialog';

export function CustomersListPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<CustomerListItem | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<CustomerListItem | undefined>();

  const { data: stats } = useCustomerStats();
  const del = useDeleteCustomer();

  const query: Partial<ListCustomersQuery> = useMemo(
    () => ({ page, pageSize: 20, sort: 'createdAt', order: 'desc', q: q || undefined, leadStatus: status === 'ALL' ? undefined : status }),
    [page, q, status],
  );
  const { data, isLoading, isFetching } = useCustomerList(query);

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`Deleted ${deleteTarget.name}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not delete'));
    }
  };

  const tiles: { label: string; value: number; status: LeadStatus | 'ALL' }[] = [
    { label: 'Total', value: stats?.total ?? 0, status: 'ALL' },
    ...LEAD_STATUSES.map((s) => ({ label: leadStatusLabel(s), value: stats?.byStatus[s] ?? 0, status: s })),
  ];

  const columns: Column<CustomerListItem>[] = [
    { key: 'name', header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'phone', header: 'Mobile', render: (c) => <span className="font-mono text-xs">{c.phone}</span> },
    { key: 'city', header: 'City', render: (c) => c.city ?? '—' },
    { key: 'leadStatus', header: 'Lead', render: (c) => <LeadStatusBadge status={c.leadStatus} /> },
    { key: 'assigned', header: 'Assigned', render: (c) => c.assignedTo?.name ?? '—' },
    {
      key: 'followUps',
      header: 'Follow-ups',
      align: 'center',
      render: (c) => (c.counts.followUpsPending > 0 ? <Badge variant="warning">{c.counts.followUpsPending}</Badge> : <span className="text-muted-foreground">—</span>),
    },
    { key: 'updatedAt', header: 'Updated', render: (c) => new Date(c.updatedAt).toLocaleDateString('en-IN') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => { setEditCustomer(c); setFormOpen(true); }}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(c)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Leads, buyers and owners — the heart of the showroom."
        actions={<Button onClick={() => { setEditCustomer(undefined); setFormOpen(true); }}><Plus className="h-4 w-4" /> Add customer</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
        {tiles.map((t) => (
          <StatCard key={t.status} label={t.label} value={t.value} loading={!stats} active={status === t.status} onClick={() => { setStatus(t.status); setPage(1); }} />
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, mobile, VIN, booking or invoice…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as LeadStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All leads</SelectItem>
            {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{leadStatusLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(c) => c.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        emptyState={
          <EmptyState
            icon={Users}
            title="No customers found"
            description={q || status !== 'ALL' ? 'Try clearing filters.' : 'Add your first customer.'}
            action={!q && status === 'ALL' ? <Button onClick={() => { setEditCustomer(undefined); setFormOpen(true); }}><Plus className="h-4 w-4" /> Add customer</Button> : undefined}
          />
        }
      />

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editCustomer} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(undefined)}
        title={`Delete ${deleteTarget?.name}?`}
        description="The customer is soft-deleted; their history is retained."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
