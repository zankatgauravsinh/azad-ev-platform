import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { AccessorySaleDto, ListAccessorySalesQuery } from '@azad/shared';
import { formatPaiseExact } from '@/lib/money';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { useAccessorySales } from '../hooks';
import { AccessorySaleDetailDialog, PAYMENT_STATUS_BADGE } from './accessory-sale-detail-dialog';

/** Accessory sales matching `filter`, newest first; a row opens the sale. */
export function AccessorySalesTable({ filter, emptyAction, showCustomer = true }: { filter: Partial<ListAccessorySalesQuery>; emptyAction?: React.ReactNode; showCustomer?: boolean }): JSX.Element {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isFetching } = useAccessorySales({ ...filter, page, pageSize: 20 });

  const columns: Column<AccessorySaleDto>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (s) => (
        <div>
          <p className="font-mono text-sm">{s.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground">{new Date(s.invoiceDate).toLocaleDateString('en-IN')}</p>
        </div>
      ),
    },
    ...(showCustomer
      ? [{ key: 'customer', header: 'Customer', render: (s: AccessorySaleDto) => <div><p className="font-medium">{s.customer.name}</p><p className="text-xs text-muted-foreground">{s.customer.phone}{s.booking ? ` · ${s.booking.code}` : ''}</p></div> }]
      : [{ key: 'booking', header: 'Booking', render: (s: AccessorySaleDto) => s.booking?.code ?? <span className="text-muted-foreground">—</span> }]),
    { key: 'items', header: 'Accessories', render: (s) => <span className="line-clamp-2 text-sm">{s.itemsSummary}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (s) => <span className="tabular-nums">{formatPaiseExact(s.total)}</span> },
    { key: 'balance', header: 'Balance', align: 'right', render: (s) => <span className="tabular-nums">{s.status === 'ACTIVE' ? formatPaiseExact(s.balance) : '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (s.status === 'CANCELLED' ? <Badge variant="destructive">Cancelled</Badge> : <Badge variant={PAYMENT_STATUS_BADGE[s.paymentStatus].variant}>{PAYMENT_STATUS_BADGE[s.paymentStatus].label}</Badge>),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(s) => s.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(s) => setOpenId(s.id)}
        emptyState={<EmptyState icon={ShoppingBag} title="No accessory sales" description="Accessories sold on their own invoice appear here." action={emptyAction} />}
      />
      <AccessorySaleDetailDialog id={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </>
  );
}
