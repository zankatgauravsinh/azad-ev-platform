import { useMemo, useState } from 'react';
import { Download, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { ExportFormat, ReportType } from '@azad/shared';
import {
  AMC_STATUSES,
  WARRANTY_CLAIM_STATUSES,
  WARRANTY_STATUSES,
  type AmcPlanDto,
  type AmcStatus,
  type WarrantyClaimDto,
  type WarrantyClaimStatus,
  type WarrantyRecordDto,
  type WarrantyStatus,
} from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/features/auth/auth-context';
import { reportsApi } from '@/features/reports/api';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAmcPlans, useClaims, useWarranties, useWarrantyDashboard, useWarrantyMutations } from '../hooks';
import { amcTone, claimTone, expiryLabel, expiryTone, warrantyTone } from '../meta';
import { CreateWarrantyDialog } from '../components/create-warranty-dialog';
import { CreateAmcDialog } from '../components/create-amc-dialog';
import { WarrantyDetailDialog } from '../components/warranty-detail-dialog';
import { AmcDetailDialog } from '../components/amc-detail-dialog';

export function WarrantyPage(): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'TECHNICIAN';
  const { generate } = useWarrantyMutations();
  const { data: dash } = useWarrantyDashboard();

  const [newWarranty, setNewWarranty] = useState(false);
  const [newAmc, setNewAmc] = useState(false);
  const [warrantyId, setWarrantyId] = useState<string | null>(null);
  const [amcId, setAmcId] = useState<string | null>(null);

  const runGenerate = async (): Promise<void> => {
    try {
      const res = await generate.mutateAsync();
      toast.success(res.created ? `${res.created} warranties created` : 'All delivered vehicles already have warranties');
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <div>
      <PageHeader title="Warranty & AMC" description="Warranties, claims and annual maintenance contracts." actions={
        canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={runGenerate} disabled={generate.isPending}><RefreshCw className="h-4 w-4" /> Generate</Button>
            <Button variant="outline" onClick={() => setNewAmc(true)}><Plus className="h-4 w-4" /> New AMC</Button>
            <Button onClick={() => setNewWarranty(true)}><Plus className="h-4 w-4" /> New warranty</Button>
          </div>
        )
      } />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active warranties" value={dash?.warranty.active ?? '—'} tone="positive" />
        <StatCard label="Expiring ≤30d" value={dash?.warranty.expiring30 ?? '—'} hint={`${dash?.warranty.expiring90 ?? 0} within 90d`} tone="warning" />
        <StatCard label="Pending claims" value={dash?.warranty.claimsPending ?? '—'} hint={`${dash?.warranty.freeServicesDue ?? 0} free services due`} tone={dash?.warranty.claimsPending ? 'warning' : 'default'} />
        <StatCard label="Active AMC" value={dash?.amc.active ?? '—'} hint={`${formatPaise(dash?.amc.revenue ?? 0)} revenue`} tone="positive" />
      </div>

      <Tabs defaultValue="warranties">
        <TabsList>
          <TabsTrigger value="warranties">Warranties</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="amc">AMC</TabsTrigger>
        </TabsList>
        <TabsContent value="warranties"><WarrantiesTab onOpen={setWarrantyId} /></TabsContent>
        <TabsContent value="claims"><ClaimsTab onOpen={setWarrantyId} /></TabsContent>
        <TabsContent value="amc"><AmcTab onOpen={setAmcId} /></TabsContent>
      </Tabs>

      {canWrite && <CreateWarrantyDialog open={newWarranty} onOpenChange={setNewWarranty} onCreated={setWarrantyId} />}
      {canWrite && <CreateAmcDialog open={newAmc} onOpenChange={setNewAmc} onCreated={setAmcId} />}
      <WarrantyDetailDialog id={warrantyId} onOpenChange={(o) => { if (!o) setWarrantyId(null); }} />
      <AmcDetailDialog id={amcId} onOpenChange={(o) => { if (!o) setAmcId(null); }} />
    </div>
  );
}

function Filters({ search, onSearch, status, onStatus, options, placeholder, exportType }: { search: string; onSearch: (v: string) => void; status: string; onStatus: (v: string) => void; options: readonly string[]; placeholder: string; exportType?: ReportType }): JSX.Element {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <Select value={status} onValueChange={onStatus}>
        <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{options.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
      </Select>
      {exportType && <ExportMenu type={exportType} />}
    </div>
  );
}

function ExportMenu({ type }: { type: ReportType }): JSX.Element {
  const download = async (format: ExportFormat): Promise<void> => {
    try {
      const blob = await reportsApi.exportReport(type, format);
      const ext = format === 'excel' ? 'xlsx' : format;
      saveBlob(blob, `${type}-report.${ext}`);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline"><Download className="h-4 w-4" /> Export</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => download('pdf')}>PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download('excel')}>Excel</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download('csv')}>CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WarrantiesTab({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<WarrantyStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useWarranties(query);

  const columns: Column<WarrantyRecordDto>[] = [
    { key: 'warrantyNumber', header: 'Warranty', render: (r) => <span className="font-mono text-xs">{r.warrantyNumber}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customerName}</p><p className="font-mono text-xs text-muted-foreground">{r.vin}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => `${r.model} ${r.variant}` },
    { key: 'expiry', header: 'Expiry', render: (r) => <div><p>{new Date(r.endDate).toLocaleDateString('en-IN')}</p>{r.status === 'ACTIVE' && <Badge variant={expiryTone(r.daysToExpiry)}>{expiryLabel(r.daysToExpiry)}</Badge>}</div> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={warrantyTone[r.status]}>{titleCase(r.status)}</Badge> },
  ];

  return (
    <>
      <Filters search={search} onSearch={(v) => { setSearch(v); setPage(1); }} status={status} onStatus={(v) => { setStatus(v as WarrantyStatus | 'ALL'); setPage(1); }} options={WARRANTY_STATUSES} placeholder="Search warranty, customer, VIN, motor or battery no.…" exportType="warranty" />
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => onOpen(r.id)}
        emptyState={<EmptyState icon={ShieldCheck} title="No warranties" description="Warranties are created on delivery, or use “Generate”." />} />
    </>
  );
}

function ClaimsTab({ onOpen }: { onOpen: (warrantyId: string) => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<WarrantyClaimStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useClaims(query);

  const columns: Column<WarrantyClaimDto>[] = [
    { key: 'claimNumber', header: 'Claim', render: (r) => <span className="font-mono text-xs">{r.claimNumber}</span> },
    { key: 'warranty', header: 'Warranty', render: (r) => <div><p className="font-mono text-xs">{r.warrantyNumber}</p><p className="text-xs text-muted-foreground">{r.customerName}</p></div> },
    { key: 'complaint', header: 'Complaint', render: (r) => <span className="line-clamp-1 max-w-[16rem]">{r.complaint}</span> },
    { key: 'cost', header: 'Cost', render: (r) => <div><p>{formatPaise(r.claimCost)}</p><p className="text-xs text-muted-foreground">Dealer {formatPaise(r.dealerCost)}</p></div> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={claimTone[r.status]}>{titleCase(r.status)}</Badge> },
  ];

  return (
    <>
      <Filters search={search} onSearch={(v) => { setSearch(v); setPage(1); }} status={status} onStatus={(v) => { setStatus(v as WarrantyClaimStatus | 'ALL'); setPage(1); }} options={WARRANTY_CLAIM_STATUSES} placeholder="Search claim, warranty, customer or complaint…" />
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => onOpen(r.warrantyId)}
        emptyState={<EmptyState icon={ShieldCheck} title="No claims" description="Warranty claims will appear here." />} />
    </>
  );
}

function AmcTab({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<AmcStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useAmcPlans(query);

  const columns: Column<AmcPlanDto>[] = [
    { key: 'amcNumber', header: 'AMC', render: (r) => <span className="font-mono text-xs">{r.amcNumber}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customerName}</p><p className="font-mono text-xs text-muted-foreground">{r.vin}</p></div> },
    { key: 'plan', header: 'Plan', render: (r) => <Badge variant="accent">{titleCase(r.planType)}</Badge> },
    { key: 'visits', header: 'Visits', render: (r) => `${r.visitsUsed} / ${r.visitsIncluded}` },
    { key: 'value', header: 'Value', render: (r) => formatPaise(r.price) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={amcTone[r.status]}>{titleCase(r.status)}</Badge> },
  ];

  return (
    <>
      <Filters search={search} onSearch={(v) => { setSearch(v); setPage(1); }} status={status} onStatus={(v) => { setStatus(v as AmcStatus | 'ALL'); setPage(1); }} options={AMC_STATUSES} placeholder="Search AMC, customer or VIN…" exportType="amc" />
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => onOpen(r.id)}
        emptyState={<EmptyState icon={ShieldCheck} title="No AMC plans" description="Create an AMC plan to start tracking visits." />} />
    </>
  );
}
