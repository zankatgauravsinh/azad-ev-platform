import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Copy, FileDown, IndianRupee, Pencil, Plus, Power, PowerOff, Star, Trash2, Truck, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  AGEING_BUCKET_LABEL,
  PURCHASE_COST_PERMISSION,
  PURCHASE_ORDER_STATUS_LABEL,
  VENDOR_BILL_KIND_LABEL,
  VENDOR_TYPE_LABEL,
  type InventoryUnitDto,
  type PurchaseOrderDto,
  type VendorBillDto,
  type VendorBillKind,
  type VendorDto,
  type VendorPaymentDto,
} from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { vendorStatusTone } from '@/features/finance/meta';
import { useInventoryList } from '@/features/inventory/hooks';
import { UnitStatusBadge } from '@/features/inventory/components/unit-status-badge';
import { usePurchaseOrders } from '@/features/purchase-orders/hooks';
import { PurchaseOrderFormDialog } from '@/features/purchase-orders/components/purchase-order-form-dialog';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { openBlob, saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { useVendor, useVendorMutations } from '../hooks';
import { useVendorBills, useVendorOverview, useVendorPaymentMutations, useVendorPayments, useVendorStatement } from '../payables-hooks';
import { vendorPayablesApi } from '../payables-api';
import { VendorFormDialog } from '../components/vendor-form-dialog';
import { PayVendorDialog, dueLabel } from '../components/pay-vendor-dialog';
import { ReasonDialog } from '../components/reason-dialog';
import { RecordHistory } from '@/features/audit/components/record-history';

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque' };

/**
 * One vendor: who they are and how to pay them, and everything traded with them — what is owed (bills, ageing,
 * advance), the payments made, the scooters bought, the statement and the purchase orders.
 */
export function VendorDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canManage = useCan('vendors.manage');
  const canCost = useCan(PURCHASE_COST_PERMISSION);
  const { data: vendor, isLoading, isError } = useVendor(id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paying, setPaying] = useState<{ preselect: { kind: VendorBillKind; id: string }[] } | null>(null);
  const [tab, setTab] = useState('overview');
  const { update, remove } = useVendorMutations();

  if (isError) return <EmptyState icon={Truck} title="Vendor not found" description="It may have been deleted." />;
  if (isLoading || !vendor) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  const toggleActive = async (): Promise<void> => {
    try {
      await update.mutateAsync({ id: vendor.id, body: { status: vendor.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } });
      toast.success(`${vendor.name} ${vendor.status === 'ACTIVE' ? 'marked inactive' : 'is active again'}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };
  const confirmDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(vendor.id);
      toast.success(`${vendor.name} deleted`);
      navigate('/vendors');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not delete'));
    }
  };

  return (
    <div>
      <button type="button" onClick={() => navigate('/vendors')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to vendors
      </button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3"><Truck className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{vendor.vendorNumber}</span>
              <span>·</span>
              <span>{VENDOR_TYPE_LABEL[vendor.type]}</span>
              <Badge variant={vendorStatusTone[vendor.status]}>{titleCase(vendor.status)}</Badge>
              {vendor.isDefaultScooterVendor && (
                <Badge variant="accent" className="gap-1"><Star className="h-3 w-3" /> Default for new scooters</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button onClick={() => setPaying({ preselect: [] })}><IndianRupee className="h-4 w-4" /> Pay vendor</Button>
          )}
          {canManage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>
              <Button variant="outline" onClick={() => void toggleActive()} disabled={update.isPending}>
                {vendor.status === 'ACTIVE' ? <><PowerOff className="h-4 w-4" /> Mark inactive</> : <><Power className="h-4 w-4" /> Make active</>}
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)} aria-label="Delete vendor"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Owed" value={formatPaise(vendor.outstanding)} tone={Number(vendor.outstanding) > 0 ? 'warning' : 'default'} onClick={() => setTab('bills')} />
        <StatCard label="Overdue" value={formatPaise(vendor.overdue)} tone={Number(vendor.overdue) > 0 ? 'danger' : 'default'} onClick={() => setTab('overview')} />
        <StatCard label="Advance" value={formatPaise(vendor.advance)} tone={Number(vendor.advance) > 0 ? 'positive' : 'default'} onClick={() => setTab('payments')} hint="Paid, not yet applied" />
        <StatCard label="Billed" value={formatPaise(vendor.totalPurchases)} hint="All bills, with GST" />
        <StatCard label="Credit" value={vendor.creditDays ? `${vendor.creditDays} days` : 'None'} hint={`${vendor.scooterCount} scooter${vendor.scooterCount === 1 ? '' : 's'} bought`} />
      </div>
      {vendor.costHidden && (
        <p className="mb-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Scooter and accessory purchase bills are left out of these figures — they show what was paid for stock, which only the owner sees.
        </p>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <ProfileCard title="Contact">
          <Row label="Contact person" value={vendor.contactPerson} />
          <Row label="Mobile" value={vendor.mobile} href={vendor.mobile ? `tel:${vendor.mobile}` : undefined} />
          <Row label="Other phone" value={vendor.altMobile} href={vendor.altMobile ? `tel:${vendor.altMobile}` : undefined} />
          <Row label="Email" value={vendor.email} href={vendor.email ? `mailto:${vendor.email}` : undefined} />
          <Row label="Address" value={[vendor.address, vendor.city, vendor.state].filter(Boolean).join(', ') || null} />
        </ProfileCard>
        <ProfileCard title="Tax">
          <Row label="GSTIN" value={vendor.gstNumber} mono copy />
          <Row label="PAN" value={vendor.pan} mono copy />
          {vendor.notes && <Row label="Notes" value={vendor.notes} />}
        </ProfileCard>
        <ProfileCard title="Pay to">
          <Row label="Account name" value={vendor.bankAccountName} />
          <Row label="Account number" value={vendor.bankAccountNumber} mono copy />
          <Row label="IFSC" value={vendor.bankIfsc} mono copy />
          <Row label="Bank" value={vendor.bankName} />
          <Row label="UPI ID" value={vendor.upiId} mono copy />
        </ProfileCard>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="scooters">Scooters ({vendor.scooterCount})</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          {canCost && <TabsTrigger value="orders">Purchase orders</TabsTrigger>}
          <TabsTrigger value="audit">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab vendor={vendor} onPay={() => setPaying({ preselect: [] })} /></TabsContent>
        <TabsContent value="bills"><BillsTab vendor={vendor} canPay={canManage} onPay={(preselect) => setPaying({ preselect })} /></TabsContent>
        <TabsContent value="payments"><PaymentsTab vendor={vendor} canManage={canManage} /></TabsContent>
        <TabsContent value="scooters"><ScootersTab vendor={vendor} canPay={canManage && canCost} onPay={(unitId) => setPaying({ preselect: [{ kind: 'SCOOTER', id: unitId }] })} /></TabsContent>
        <TabsContent value="statement"><StatementTab vendor={vendor} /></TabsContent>
        {canCost && <TabsContent value="orders"><OrdersTab vendor={vendor} canManage={canManage} /></TabsContent>}
        <TabsContent value="audit"><Card><CardContent className="p-4"><RecordHistory entityType="Vendor" entityId={vendor.id} /></CardContent></Card></TabsContent>
      </Tabs>

      <VendorFormDialog open={editing} onOpenChange={setEditing} vendor={vendor} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${vendor.name}?`}
        description="Only a vendor with no scooters, purchases, expenses, payments or orders can be deleted. One with history can be marked inactive instead — it stays on its old records."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
      <PayVendorDialog open={paying !== null} onOpenChange={(o) => !o && setPaying(null)} vendorId={vendor.id} vendorName={vendor.name} preselect={paying?.preselect ?? []} />
    </div>
  );
}

function OverviewTab({ vendor, onPay }: { vendor: VendorDto; onPay: () => void }): JSX.Element {
  const { data: o, isLoading } = useVendorOverview(vendor.id);
  const canManage = useCan('vendors.manage');
  if (isLoading || !o) return <Skeleton className="h-48 w-full" />;
  const max = Math.max(1, ...o.ageing.buckets.map((b) => Number(b.amount)));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">What is owed, by how late</h3>
            {canManage && BigInt(o.billsDue) > 0n && <Button size="sm" onClick={onPay}><IndianRupee className="h-4 w-4" /> Pay</Button>}
          </div>
          {BigInt(o.ageing.totalDue) === 0n ? (
            <p className="text-sm text-muted-foreground">Nothing is owed to {vendor.name}.</p>
          ) : (
            <ul className="space-y-2" aria-label="Ageing">
              {o.ageing.buckets.map((b) => (
                <li key={b.bucket} className="grid grid-cols-[7rem_1fr_6.5rem] items-center gap-3 text-sm">
                  <span className={b.bucket === 'NOT_DUE' ? 'text-muted-foreground' : ''}>{AGEING_BUCKET_LABEL[b.bucket]}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`block h-full rounded-full ${b.bucket === 'NOT_DUE' ? 'bg-emerald-500' : b.bucket === 'D1_30' ? 'bg-amber-500' : 'bg-destructive'}`}
                      style={{ width: `${(Number(b.amount) / max) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{formatPaise(b.amount)}{b.count ? <span className="text-xs text-muted-foreground"> · {b.count}</span> : null}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
            <Figure label="Billed in total" value={formatPaise(o.totalBilled)} />
            <Figure label="Paid in total" value={formatPaise(o.totalPaid)} />
            <Figure label="Advance" value={formatPaise(o.advance)} />
            <Figure label={BigInt(o.netPayable) < 0n ? 'Vendor holds (net)' : 'Net payable'} value={formatPaise(BigInt(o.netPayable) < 0n ? -BigInt(o.netPayable) : BigInt(o.netPayable))} strong />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <h3 className="font-semibold">Trade</h3>
          <dl className="space-y-1.5">
            <Pair label="Scooters bought" value={String(o.scooters.total)} />
            <Pair label="In stock" value={String(o.scooters.inStock)} />
            <Pair label="Sold" value={String(o.scooters.sold)} />
            {!o.costHidden && <Pair label="Not paid yet" value={String(o.scooters.unpaid)} />}
            {o.scooters.expensedBefore > 0 && (
              <Pair label="Bought before tracking" value={`${o.scooters.expensedBefore}${o.expensedBeforeCost ? ` · ${formatPaise(o.expensedBeforeCost)}` : ''}`} />
            )}
            {!o.costHidden && <Pair label="Accessory purchases" value={String(o.accessoryPurchases)} />}
            {!o.costHidden && <Pair label="Open purchase orders" value={String(o.openPurchaseOrders)} />}
            <Pair label="Last purchase" value={fmtDate(o.lastPurchaseDate)} />
            <Pair label="Last payment" value={fmtDate(o.lastPaymentDate)} />
          </dl>
          {o.scooters.expensedBefore > 0 && (
            <p className="text-xs text-muted-foreground">Scooters bought before per-scooter tracking had their cost recorded as Vehicle Purchase expenses, so they are not bills here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BillsTab({ vendor, canPay, onPay }: { vendor: VendorDto; canPay: boolean; onPay: (preselect: { kind: VendorBillKind; id: string }[]) => void }): JSX.Element {
  const [status, setStatus] = useState<'unpaid' | 'all'>('unpaid');
  const { data, isLoading } = useVendorBills(vendor.id, { status });
  const [selected, setPicked] = useState<Set<string>>(new Set());
  const bills = data ?? [];
  const key = (b: VendorBillDto): string => `${b.kind}:${b.id}`;
  // Only bills still owed stay ticked (one paid meanwhile drops out of the selection).
  const picked = new Set(bills.filter((b) => !b.paid && selected.has(key(b))).map(key));
  const linkOf = (b: VendorBillDto): string | null => (b.kind === 'SCOOTER' ? `/inventory/${b.id}` : null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={status} onValueChange={(v) => { setStatus(v as 'unpaid' | 'all'); setPicked(new Set()); }}>
          <SelectTrigger className="w-40" aria-label="Which bills"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unpaid">Still owed</SelectItem>
            <SelectItem value="all">All bills</SelectItem>
          </SelectContent>
        </Select>
        {canPay && picked.size > 0 && (
          <Button onClick={() => onPay(bills.filter((b) => picked.has(key(b))).map((b) => ({ kind: b.kind, id: b.id })))}>
            <IndianRupee className="h-4 w-4" /> Pay {picked.size} selected
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : bills.length === 0 ? (
        <EmptyState icon={Wallet} title={status === 'unpaid' ? 'Nothing owed' : 'No bills yet'} description="Scooters, accessory purchases and expenses with this vendor show here." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {canPay && <TableHead className="w-8" />}
                  <TableHead>Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => {
                  const due = dueLabel(b);
                  const link = linkOf(b);
                  return (
                    <TableRow key={key(b)}>
                      {canPay && (
                        <TableCell>
                          {!b.paid && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              aria-label={`Select ${b.number}`}
                              checked={picked.has(key(b))}
                              onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(key(b)); else n.delete(key(b)); return n; })}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <p className="font-mono text-xs">{link ? <Link to={link} className="hover:underline">{b.number}</Link> : b.number}</p>
                        <p className="text-xs text-muted-foreground">{VENDOR_BILL_KIND_LABEL[b.kind]} · {b.description}{b.vendorBillNumber ? ` · bill ${b.vendorBillNumber}` : ''}</p>
                      </TableCell>
                      <TableCell>{fmtDate(b.date)}</TableCell>
                      <TableCell>
                        <Badge variant={due.variant}>{due.text}</Badge>
                        {!b.paid && <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(b.dueDate)}</p>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaise(b.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.paid ? '—' : formatPaise(b.balance)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentsTab({ vendor, canManage }: { vendor: VendorDto; canManage: boolean }): JSX.Element {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useVendorPayments({ vendorId: vendor.id, page, pageSize: 20 });
  const { cancel } = useVendorPaymentMutations();
  const [cancelling, setCancelling] = useState<VendorPaymentDto | null>(null);
  const [applying, setApplying] = useState<VendorPaymentDto | null>(null);
  const voucher = async (p: VendorPaymentDto): Promise<void> => {
    try {
      openBlob(await vendorPayablesApi.voucher(p.id), `vendor-payment-${p.paymentNumber}.pdf`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };
  const columns: Column<VendorPaymentDto>[] = [
    { key: 'number', header: 'Payment', render: (p) => <span className="font-mono text-xs">{p.paymentNumber}</span> },
    { key: 'date', header: 'Date', render: (p) => fmtDate(p.paidAt) },
    { key: 'method', header: 'Paid by', render: (p) => <div><p>{METHOD_LABEL[p.method] ?? p.method}</p>{p.reference && <p className="text-xs text-muted-foreground">{p.reference}</p>}</div> },
    {
      key: 'for',
      header: 'For',
      render: (p) => (
        <div className="max-w-xs text-xs">
          {p.allocations.length ? [...new Set(p.allocations.map((a) => a.billNumber))].join(', ') : <span className="text-muted-foreground">—</span>}
          {p.poNumber && <p className="text-muted-foreground">Advance against {p.poNumber}</p>}
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => <span className="tabular-nums">{formatPaise(p.amount)}</span> },
    {
      key: 'advance',
      header: 'Advance left',
      align: 'right',
      render: (p) => (p.status === 'CANCELLED' ? <Badge variant="muted">Cancelled</Badge> : Number(p.unapplied) > 0 ? <span className="font-medium tabular-nums text-emerald-600">{formatPaise(p.unapplied)}</span> : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => void voucher(p)} aria-label={`Voucher ${p.paymentNumber}`}><FileDown className="h-4 w-4" /></Button>
          {canManage && p.status === 'ACTIVE' && Number(p.unapplied) > 0 && <Button size="sm" variant="outline" onClick={() => setApplying(p)}>Apply</Button>}
          {canManage && p.status === 'ACTIVE' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(p)} aria-label={`Cancel ${p.paymentNumber}`}><Undo2 className="h-4 w-4" /></Button>}
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(p) => p.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        emptyState={<EmptyState icon={Wallet} title="No payments yet" description={`Payments to ${vendor.name} show here.`} />}
      />
      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.paymentNumber ?? 'payment'}?`}
        description="The bills it paid become unpaid again, and it leaves the cash book. The payment stays on record as cancelled."
        confirmLabel="Cancel payment"
        onConfirm={async (reason) => {
          try {
            await cancel.mutateAsync({ id: cancelling!.id, body: { reason } });
            toast.success(`${cancelling!.paymentNumber} cancelled`);
          } catch (e) {
            toast.error(apiErrorMessage(e));
            throw e;
          }
        }}
      />
      {applying && <PayVendorDialog open onOpenChange={(o) => !o && setApplying(null)} vendorId={vendor.id} vendorName={vendor.name} applyFrom={applying} />}
    </>
  );
}

function ScootersTab({ vendor, canPay, onPay }: { vendor: VendorDto; canPay: boolean; onPay: (unitId: string) => void }): JSX.Element {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [paid, setPaid] = useState<'ALL' | 'unpaid' | 'paid'>('ALL');
  const { data, isLoading, isFetching } = useInventoryList({ vendorId: vendor.id, page, pageSize: 20, sort: 'purchaseDate', order: 'desc', ...(paid === 'ALL' ? {} : { purchasePaid: paid === 'paid' }) });
  const showCost = data?.data.some((u) => u.purchaseCost !== undefined);
  const columns: Column<InventoryUnitDto>[] = [
    { key: 'vin', header: 'VIN', render: (u) => <Link to={`/inventory/${u.id}`} className="font-mono text-xs hover:underline" onClick={(e) => e.stopPropagation()}>{u.vin}</Link> },
    { key: 'model', header: 'Scooter', render: (u) => `${u.variant.model.name} ${u.variant.name} (${u.variant.colour})` },
    { key: 'purchaseDate', header: 'Bought', render: (u) => <div><p>{fmtDate(u.purchaseDate)}</p>{u.vendorBillNumber && <p className="text-xs text-muted-foreground">Bill {u.vendorBillNumber}</p>}</div> },
    ...(showCost ? [{ key: 'cost', header: 'Cost', align: 'right' as const, render: (u: InventoryUnitDto) => <span className="tabular-nums">{u.purchaseCost !== undefined ? formatPaise(u.purchaseCost) : '—'}</span> }] : []),
    {
      key: 'paid',
      header: 'Paid',
      render: (u) =>
        u.costInExpenses ? <Badge variant="muted" title="Bought before per-scooter tracking — its cost was a Vehicle Purchase expense">Expensed</Badge>
          : u.purchasePaid ? <Badge variant="success">Paid{u.purchasePaidAt ? ` ${fmtDate(u.purchasePaidAt)}` : ''}</Badge>
            : canPay ? <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onPay(u.id); }}>Pay</Button>
              : <Badge variant="warning">Owed</Badge>,
    },
    { key: 'status', header: 'Status', render: (u) => <UnitStatusBadge status={u.status} /> },
  ];
  return (
    <div className="space-y-3">
      <Select value={paid} onValueChange={(v) => { setPaid(v as typeof paid); setPage(1); }}>
        <SelectTrigger className="w-44" aria-label="Paid to vendor"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All scooters</SelectItem>
          <SelectItem value="unpaid">Not paid yet</SelectItem>
          <SelectItem value="paid">Paid / expensed</SelectItem>
        </SelectContent>
      </Select>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(u) => u.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(u) => navigate(`/inventory/${u.id}`)}
        emptyState={<EmptyState icon={Truck} title="No scooters" description="Scooters bought from this vendor show here." />}
      />
    </div>
  );
}

/** The financial year's first day (April) as YYYY-MM-DD. */
const fyStart = (): string => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-04-01`;
};

function StatementTab({ vendor }: { vendor: VendorDto }): JSX.Element {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const { data: st, isLoading } = useVendorStatement(vendor.id, range);
  const download = async (): Promise<void> => {
    try {
      saveBlob(await vendorPayablesApi.statementPdf(vendor.id, range), `statement-${vendor.vendorNumber}.pdf`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };
  const money = (v: string): string => (BigInt(v) === 0n ? '' : formatPaise(v));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="st-from">From</Label><Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="st-to">To</Label><Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={() => void download()}><FileDown className="h-4 w-4" /> Statement PDF</Button>
      </div>
      {isLoading || !st ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={5} className="font-medium">Opening balance</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatPaise(st.opening)}</TableCell>
                </TableRow>
                {st.rows.map((r, i) => (
                  <TableRow key={`${r.number}-${i}`}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.number}</TableCell>
                    <TableCell className="text-sm">{r.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.billed)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">{money(r.paid)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(r.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={3} className="font-semibold">Closing balance</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPaise(st.totalBilled)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPaise(st.totalPaid)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatPaise(st.closing)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Balance = owed to {vendor.name}; a negative balance is an advance with them.</p>
    </div>
  );
}

function OrdersTab({ vendor, canManage }: { vendor: VendorDto; canManage: boolean }): JSX.Element {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isFetching } = usePurchaseOrders({ vendorId: vendor.id, page, pageSize: 20 });
  const columns: Column<PurchaseOrderDto>[] = [
    { key: 'po', header: 'Order', render: (o) => <span className="font-mono text-xs">{o.poNumber}</span> },
    { key: 'date', header: 'Date', render: (o) => fmtDate(o.orderDate) },
    { key: 'pi', header: 'PI', render: (o) => o.piNumber ?? '—' },
    { key: 'received', header: 'Received', render: (o) => `${o.receivedQty} / ${o.orderedQty}` },
    { key: 'total', header: 'Total', align: 'right', render: (o) => <span className="tabular-nums">{formatPaise(o.total)}</span> },
    { key: 'status', header: 'Status', render: (o) => <Badge variant={o.status === 'ORDERED' ? 'info' : o.status === 'CLOSED' ? 'success' : 'muted'}>{PURCHASE_ORDER_STATUS_LABEL[o.status]}</Badge> },
  ];
  return (
    <div className="space-y-3">
      {canManage && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New purchase order</Button>}
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(o) => o.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(o) => navigate(`/purchase-orders/${o.id}`)}
        emptyState={<EmptyState icon={ClipboardList} title="No purchase orders" description={`Orders placed with ${vendor.name} show here.`} />}
      />
      <PurchaseOrderFormDialog open={creating} onOpenChange={setCreating} defaultVendorId={vendor.id} onSaved={(o) => navigate(`/purchase-orders/${o.id}`)} />
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-base font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function ProfileCard({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-accent">{title}</h3>
        <dl className="space-y-1.5 text-sm">{children}</dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, href, mono, copy }: { label: string; value: string | null; href?: string; mono?: boolean; copy?: boolean }): JSX.Element {
  const copyValue = async (): Promise<void> => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`flex min-w-0 items-center gap-1 text-right ${mono ? 'font-mono text-xs' : ''}`}>
        {!value ? <span className="text-muted-foreground">—</span> : href ? <a href={href} className="break-all hover:underline">{value}</a> : <span className="break-all">{value}</span>}
        {copy && value && (
          <button type="button" onClick={() => void copyValue()} className="text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`}>
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </dd>
    </div>
  );
}
