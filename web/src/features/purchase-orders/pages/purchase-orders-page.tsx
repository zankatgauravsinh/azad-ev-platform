import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrderDto, type PurchaseOrderStatus } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { formatPaise } from '@/lib/money';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePurchaseOrders } from '../hooks';
import { PurchaseOrderFormDialog } from '../components/purchase-order-form-dialog';
import { ReceiptBadge, orderStatusTone } from '../components/order-badges';

const ALL = '__all__';
const PENDING = '__pending__';
const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');

/** Orders placed with vendors: what was ordered, what has arrived, the PI and any advance paid. */
export function PurchaseOrdersPage(): JSX.Element {
  const navigate = useNavigate();
  const canManage = useCan('vendors.manage');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<string>(PENDING);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = useMemo(
    () => ({ page, pageSize: 20, q: q || undefined, ...(status === PENDING ? { pending: true } : status === ALL ? {} : { status: status as PurchaseOrderStatus }) }),
    [page, q, status],
  );
  const { data, isLoading, isFetching } = usePurchaseOrders(query);

  const columns: Column<PurchaseOrderDto>[] = [
    { key: 'po', header: 'Order', render: (o) => <span className="font-mono text-xs">{o.poNumber}</span> },
    { key: 'vendor', header: 'Vendor', render: (o) => <span className="font-medium">{o.vendorName}</span> },
    { key: 'date', header: 'Ordered', render: (o) => <div><p>{fmtDate(o.orderDate)}</p>{o.expectedDate && <p className="text-xs text-muted-foreground">Expected {fmtDate(o.expectedDate)}</p>}</div> },
    { key: 'pi', header: 'PI', render: (o) => <div><p>{o.piNumber ?? '—'}</p>{o.documentCount > 0 && <p className="text-xs text-muted-foreground">{o.documentCount} document{o.documentCount === 1 ? '' : 's'}</p>}</div> },
    { key: 'received', header: 'Received', render: (o) => <div className="space-y-0.5"><p className="tabular-nums">{o.receivedQty} / {o.orderedQty}</p><ReceiptBadge receipt={o.receipt} /></div> },
    { key: 'total', header: 'Total', align: 'right', render: (o) => <div className="text-right"><p className="tabular-nums">{formatPaise(o.total)}</p>{o.advancePaid !== '0' && <p className="text-xs text-emerald-600">Advance {formatPaise(o.advancePaid)}</p>}</div> },
    { key: 'status', header: 'Status', render: (o) => <Badge variant={orderStatusTone[o.status]}>{PURCHASE_ORDER_STATUS_LABEL[o.status]}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Order scooters and accessories from vendors, attach their PI, and receive the stock against the order."
        actions={canManage ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New purchase order</Button> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search order no., PI no., vendor…" aria-label="Search purchase orders" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PENDING}>Waiting for stock</SelectItem>
            {PURCHASE_ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{PURCHASE_ORDER_STATUS_LABEL[s]}</SelectItem>)}
            <SelectItem value={ALL}>All orders</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(o) => o.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(o) => navigate(`/purchase-orders/${o.id}`)}
        emptyState={<EmptyState icon={ClipboardList} title="No purchase orders" description={canManage ? 'Create an order for the scooters and accessories you are buying.' : 'No order matches.'} />}
      />
      <PurchaseOrderFormDialog open={creating} onOpenChange={setCreating} onSaved={(o) => navigate(`/purchase-orders/${o.id}`)} />
    </div>
  );
}
