import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, FileText, MoreHorizontal, Plus, Search, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { QUOTATION_STATUSES, QuotationStatus, type ListQuotationsQuery } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useQuotations, useSalesInvalidate } from '../hooks';
import { salesApi, type QuotationDto } from '../api';
import { QuotationStatusBadge } from '../components/status-badges';
import { QuotationFormDialog } from '../components/quotation-form-dialog';
import { ConvertQuotationDialog } from '../components/convert-quotation-dialog';

export function QuotationsListPage(): JSX.Element {
  const navigate = useNavigate();
  const invalidate = useSalesInvalidate();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<QuotationStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [convertId, setConvertId] = useState<string | null>(null);

  const query: Partial<ListQuotationsQuery> = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useQuotations(query);

  const downloadPdf = async (id: string, code: string): Promise<void> => {
    try { saveBlob(await salesApi.quotationPdf(id), `${code.replace(/\//g, '-')}.pdf`); }
    catch (e) { toast.error(apiErrorMessage(e, 'PDF failed')); }
  };
  const setStatusOf = async (id: string, s: QuotationStatus): Promise<void> => {
    try { await salesApi.changeQuotationStatus(id, s); invalidate(); toast.success(`Marked ${titleCase(s)}`); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };
  const duplicate = async (id: string): Promise<void> => {
    try { const dup = await salesApi.duplicateQuotation(id); invalidate(); toast.success(`Duplicated → ${dup.code}`); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const columns: Column<QuotationDto>[] = [
    { key: 'code', header: 'Quotation', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customer.name}</p><p className="text-xs text-muted-foreground">{r.customer.phone}</p></div> },
    { key: 'vehicle', header: 'Vehicle', render: (r) => `${r.variant.model.name} ${r.variant.name}` },
    { key: 'total', header: 'On-road', align: 'right', render: (r) => <span className="tabular-nums">{formatPaise(r.total)}</span> },
    { key: 'status', header: 'Status', render: (r) => <QuotationStatusBadge status={r.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => downloadPdf(r.id, r.code)}><FileText className="h-4 w-4" /> Download PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicate(r.id)}><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
            {!r.booking && <DropdownMenuItem onClick={() => setConvertId(r.id)}><ShoppingCart className="h-4 w-4" /> Convert to booking</DropdownMenuItem>}
            {r.status === QuotationStatus.DRAFT && <DropdownMenuItem onClick={() => setStatusOf(r.id, QuotationStatus.SENT)}>Mark Sent</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Quotations" description="Estimates that convert into bookings." actions={<Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New quotation</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search code or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as QuotationStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{QUOTATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => navigate(`/quotations/${r.id}`)}
        emptyState={<EmptyState icon={FileText} title="No quotations" description="Create your first estimate." action={<Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> New quotation</Button>} />} />
      <QuotationFormDialog open={formOpen} onOpenChange={setFormOpen} />
      {convertId && <ConvertQuotationDialog open={Boolean(convertId)} onOpenChange={(o) => !o && setConvertId(null)} quotationId={convertId} />}
    </div>
  );
}
