import { useMemo, useState } from 'react';
import { FileBadge, Plus, Search } from 'lucide-react';
import type { RtoInvoiceDto } from '@azad/shared';
import { formatPaise } from '@/lib/money';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRtoInvoices } from '../hooks';
import { RtoInvoiceDetailDialog } from '../components/rto-invoice-detail-dialog';
import { RtoInvoiceFormDialog } from '../components/rto-invoice-form-dialog';

export function RtoInvoicesPage(): JSX.Element {
  const { can } = useAuth();
  const canView = can('rto.view');
  const canGenerate = can('rto.generate');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [openId, setOpenId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const query = useMemo(() => ({ page, pageSize: 20, q: q.trim() || undefined }), [page, q]);
  const { data, isLoading, isFetching } = useRtoInvoices(query, canView);

  const columns: Column<RtoInvoiceDto>[] = [
    { key: 'number', header: 'RTO invoice', render: (r) => <div><span className="font-mono text-xs">{r.invoiceNumber}</span>{r.revision > 1 && <Badge variant="muted" className="ml-2">Rev {r.revision}</Badge>}</div> },
    { key: 'date', header: 'Date', render: (r) => new Date(r.invoiceDate).toLocaleDateString('en-IN') },
    { key: 'customer', header: 'Customer', render: (r) => <div><p className="font-medium">{r.customer.name}</p><p className="font-mono text-xs text-muted-foreground">{r.vehicle.vin}</p></div> },
    { key: 'booking', header: 'Booking', render: (r) => <span className="font-mono text-xs">{r.booking.code}</span> },
    { key: 'price', header: 'Selling price', render: (r) => <span className="tabular-nums">{formatPaise(r.sellingPrice)}</span> },
    { key: 'gst', header: 'GST', render: (r) => <span className="tabular-nums">{formatPaise(r.gstAmount)} <span className="text-xs text-muted-foreground">@ {r.gstRate}%</span></span> },
    { key: 'total', header: 'Total', render: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.total)}</span> },
  ];

  return (
    <div>
      <PageHeader title="RTO Invoices" description="Invoices for vehicle registration — raised from a booking with GST on your price."
        actions={canGenerate ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> Generate RTO invoice</Button> : undefined} />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-9" aria-label="Search RTO invoices" placeholder="Search by RTO invoice no., customer, mobile, VIN or booking…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => setOpenId(r.id)}
        emptyState={<EmptyState icon={FileBadge} title="No RTO invoices" description={canGenerate ? 'Generate one from a booking to see it here.' : 'RTO invoices appear here once generated.'} action={canGenerate ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> Generate RTO invoice</Button> : undefined} />} />

      <RtoInvoiceDetailDialog id={openId} onOpenChange={(o) => { if (!o) setOpenId(null); }} />
      {canGenerate && <RtoInvoiceFormDialog open={formOpen} onOpenChange={setFormOpen} onDone={(id) => setOpenId(id)} />}
    </div>
  );
}
