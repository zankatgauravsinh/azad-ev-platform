import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, FileSpreadsheet, FileText, ScrollText, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACTIVITY_ACTIONS,
  AUDIT_ACTION_LABEL,
  AUDIT_SOURCES,
  AUDIT_SOURCE_LABEL,
  auditEntityLabel,
  type ActivityAction,
  type AuditEntryDto,
  type AuditExportFormat,
  type AuditSource,
} from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { saveBlob } from '@/lib/download';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { auditApi, type AuditFilters } from '../api';
import { useAuditFacets, useAuditLog } from '../hooks';
import { AuditEntryDialog } from '../components/audit-entry-dialog';
import { auditActionTone, formatWhen } from '../components/audit-meta';

const ALL = '__all__';
const day = (offset = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Who did what, when — the whole company's audit trail, searchable and exportable. Owner and Manager (audit.view). */
export function AuditLogPage(): JSX.Element {
  const navigate = useNavigate();
  const canView = useCan('audit.view');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [from, setFrom] = useState(day(30));
  const [to, setTo] = useState(day(0));
  const [actorId, setActorId] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [entityType, setEntityType] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  const [exporting, setExporting] = useState<AuditExportFormat | null>(null);

  const filters: AuditFilters = useMemo(
    () => ({
      q: q || undefined,
      from: from || undefined,
      to: to || undefined,
      actorId: actorId === ALL ? undefined : actorId,
      action: action === ALL ? undefined : (action as ActivityAction),
      entityType: entityType === ALL ? undefined : entityType,
      source: source === ALL ? undefined : (source as AuditSource),
    }),
    [q, from, to, actorId, action, entityType, source],
  );
  const { data, isLoading, isFetching, isError } = useAuditLog({ ...filters, page, pageSize: 25 });
  const { data: facets } = useAuditFacets();
  // Record types by the label people know (a type and its automatic-entry route share one label).
  const types = useMemo(() => {
    const byLabel = new Map<string, string>();
    for (const t of facets?.entityTypes ?? []) if (!byLabel.has(auditEntityLabel(t))) byLabel.set(auditEntityLabel(t), t);
    return [...byLabel].sort(([a], [b]) => a.localeCompare(b));
  }, [facets]);
  const set = <T,>(setter: (v: T) => void) => (v: T): void => { setter(v); setPage(1); };

  const exportAs = async (format: AuditExportFormat): Promise<void> => {
    setExporting(format);
    try {
      saveBlob(await auditApi.export(filters, format), `audit-log-${day(0)}.${format}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Export failed'));
    } finally {
      setExporting(null);
    }
  };

  if (!canView) return <EmptyState icon={ScrollText} title="Not available" description="The audit log is for the owner and managers." />;

  const columns: Column<AuditEntryDto>[] = [
    { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap text-xs">{formatWhen(e.createdAt)}</span> },
    {
      key: 'who',
      header: 'Who',
      render: (e) => (
        <div>
          <p className="font-medium">{e.actor?.name ?? AUDIT_SOURCE_LABEL[e.source]}</p>
          {e.actor?.role && <p className="text-xs text-muted-foreground">{e.actor.role}</p>}
        </div>
      ),
    },
    { key: 'action', header: 'Action', render: (e) => <Badge variant={auditActionTone[e.action]}>{AUDIT_ACTION_LABEL[e.action]}</Badge> },
    {
      key: 'record',
      header: 'Record',
      render: (e) => (
        <div>
          <p>{auditEntityLabel(e.entityType)}</p>
          {e.entityLabel && <p className="font-mono text-xs text-muted-foreground">{e.entityLabel}</p>}
        </div>
      ),
    },
    {
      key: 'summary',
      header: 'What happened',
      render: (e) => (
        <div className="max-w-md">
          <p className="line-clamp-2">{e.summary}</p>
          {e.source === 'AUTO' && <Badge variant="outline" className="mt-1">{AUDIT_SOURCE_LABEL.AUTO}</Badge>}
        </div>
      ),
    },
    { key: 'changes', header: 'Changes', align: 'right', render: (e) => <span className="tabular-nums text-muted-foreground">{e.changes ? Object.keys(e.changes).length : '—'}</span> },
  ];

  return (
    <div>
      <button type="button" onClick={() => navigate('/settings')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to settings
      </button>
      <PageHeader
        title="Audit log"
        description="Everything anyone did — who, when, from where, and what changed. Entries can never be edited or deleted."
        actions={
          <>
            <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportAs('xlsx')}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportAs('pdf')}><FileText className="h-4 w-4" /> PDF</Button>
            <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportAs('csv')}><FileDown className="h-4 w-4" /> CSV</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search what happened, record, person…" aria-label="Search the audit log" value={search} onChange={(e) => set(setSearch)(e.target.value)} />
        </div>
        <label className="text-xs text-muted-foreground">
          From
          <Input type="date" aria-label="From" className="mt-0.5 w-40" value={from} max={to || undefined} onChange={(e) => set(setFrom)(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <Input type="date" aria-label="To" className="mt-0.5 w-40" value={to} min={from || undefined} onChange={(e) => set(setTo)(e.target.value)} />
        </label>
        <div className="flex gap-1">
          {[['Today', 0], ['7 days', 7], ['30 days', 30], ['1 year', 365]].map(([label, days]) => (
            <Button key={label} size="sm" variant="ghost" onClick={() => { setFrom(day(Number(days))); setTo(day(0)); setPage(1); }}>{label}</Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>All</Button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={actorId} onValueChange={set(setActorId)}>
          <SelectTrigger className="w-44" aria-label="Person"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {(facets?.actors ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={set(setAction)}>
          <SelectTrigger className="w-44" aria-label="Action"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {ACTIVITY_ACTIONS.map((a) => <SelectItem key={a} value={a}>{AUDIT_ACTION_LABEL[a]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={entityType} onValueChange={set(setEntityType)}>
          <SelectTrigger className="w-48" aria-label="Record type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All records</SelectItem>
            {types.map(([label, type]) => <SelectItem key={type} value={type}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={set(setSource)}>
          <SelectTrigger className="w-44" aria-label="Source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any source</SelectItem>
            {AUDIT_SOURCES.map((s) => <SelectItem key={s} value={s}>{AUDIT_SOURCE_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <EmptyState icon={ScrollText} title="Could not load the audit log" description="Check your connection and try again." />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          getRowId={(e) => e.id}
          page={data?.meta}
          onPageChange={setPage}
          loading={isLoading || isFetching}
          onRowClick={setSelected}
          emptyState={<EmptyState icon={ScrollText} title="Nothing found" description="No entries match these filters." />}
        />
      )}

      <AuditEntryDialog entry={selected} onOpenChange={(o) => { if (!o) setSelected(null); }} />
    </div>
  );
}
