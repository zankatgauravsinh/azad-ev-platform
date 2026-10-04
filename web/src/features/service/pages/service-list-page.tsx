import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Plus, Search, Wrench } from 'lucide-react';
import { SERVICE_STATUSES, type ListServiceJobsQuery, type ServiceJobDto, type ServiceStatus } from '@azad/shared';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServiceJobs } from '../hooks';
import { ServiceStatusBadge, PriorityBadge } from '../components/badges';
import { ServiceJobFormDialog } from '../components/service-job-form-dialog';

export function ServiceListPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canView = can('service.view');
  const canCreate = can('service.create'); // POST /service/jobs
  const canViewReports = can('reports.view'); // Service Reports entry (GET /service/reports)
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<ServiceStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const query: Partial<ListServiceJobsQuery> = useMemo(
    () => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }),
    [page, q, status],
  );
  const { data, isLoading, isFetching } = useServiceJobs(query, canView);

  const columns: Column<ServiceJobDto>[] = [
    { key: 'code', header: 'Job card', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-muted-foreground">{r.customer.phone}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => <div><p>{r.unit.model} {r.unit.variant}</p><p className="font-mono text-xs text-muted-foreground">{r.unit.vin}</p></div> },
    { key: 'type', header: 'Type', render: (r) => titleCase(r.type) },
    { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={r.priority} /> },
    { key: 'technician', header: 'Technician', render: (r) => r.technician?.name ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <ServiceStatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Service" description="Job cards, repairs and after-sales." actions={
        <div className="flex gap-2">
          {canViewReports && <Button variant="outline" onClick={() => navigate('/service/reports')}><BarChart3 className="h-4 w-4" /> Reports</Button>}
          {canCreate && <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New job card</Button>}
        </div>
      } />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search job card, customer, VIN, complaint or technician…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as ServiceStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{SERVICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => navigate(`/service/${r.id}`)}
        emptyState={<EmptyState icon={Wrench} title="No job cards" description={canCreate ? 'Create a job card to start a service.' : 'No service jobs yet.'} action={canCreate ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New job card</Button> : undefined} />} />
      {canCreate && <ServiceJobFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={(id) => navigate(`/service/${id}`)} />}
    </div>
  );
}
