import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, ClipboardList, FileDown, FileText, IndianRupee, Lock, PackagePlus, Pencil, RotateCcw, Send, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  PURCHASE_ORDER_DOCUMENT_LABEL,
  PURCHASE_ORDER_DOCUMENT_TYPES,
  PURCHASE_ORDER_STATUS_LABEL,
  type PurchaseOrderDetailDto,
  type PurchaseOrderDocumentType,
  type PurchaseOrderLineDto,
} from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { UnitFormDialog, type ReceiveAgainstLine } from '@/features/inventory/components/unit-form-dialog';
import { PayVendorDialog } from '@/features/vendors/components/pay-vendor-dialog';
import { ReasonDialog } from '@/features/vendors/components/reason-dialog';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, formatPaiseExact } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/empty-state';
import { usePurchaseOrder, usePurchaseOrderMutations } from '../hooks';
import { purchaseOrdersApi } from '../api';
import { PurchaseOrderFormDialog } from '../components/purchase-order-form-dialog';
import { ReceiveAccessoriesDialog } from '../components/receive-accessories-dialog';
import { ReceiptBadge, orderStatusTone } from '../components/order-badges';
import { RecordHistory } from '@/features/audit/components/record-history';

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');

/** One purchase order: its lines and what has arrived, the vendor's PI and documents, advances paid, and actions. */
export function PurchaseOrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canManage = useCan('vendors.manage');
  const canAddScooters = useCan('inventory.create');
  const { data: order, isLoading, isError } = usePurchaseOrder(id);
  const m = usePurchaseOrderMutations();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [payingAdvance, setPayingAdvance] = useState(false);
  const [receivingLine, setReceivingLine] = useState<ReceiveAgainstLine | null>(null);
  const [receivingAccessories, setReceivingAccessories] = useState(false);

  if (isError) return <EmptyState icon={ClipboardList} title="Purchase order not found" description="It may belong to another showroom, or you may not have purchase-cost access." />;
  if (isLoading || !order) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  const open = order.status === 'DRAFT' || order.status === 'ORDERED';
  const run = async (action: () => Promise<PurchaseOrderDetailDto>, done: string): Promise<void> => {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };
  const download = async (): Promise<void> => {
    try {
      saveBlob(await purchaseOrdersApi.pdf(order.id), `purchase-order-${order.poNumber}.pdf`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };
  const receiveScooter = (l: PurchaseOrderLineDto): void => {
    if (!l.variant) return;
    setReceivingLine({ lineId: l.id, poNumber: order.poNumber, vendorId: order.vendorId, modelId: l.variant.model.id, variantId: l.variant.id, description: l.description, unitCost: l.unitCost, gstRateBp: l.gstRateBp, remaining: l.quantity - l.received });
  };
  const accessoriesLeft = order.lines.some((l) => l.kind === 'ACCESSORY' && l.received < l.quantity);
  const nothingReceived = order.receivedQty === 0;

  return (
    <div>
      <button type="button" onClick={() => navigate('/purchase-orders')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to purchase orders
      </button>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="font-mono">{order.poNumber}</span>
            <Badge variant={orderStatusTone[order.status]}>{PURCHASE_ORDER_STATUS_LABEL[order.status]}</Badge>
            {order.status !== 'DRAFT' && order.status !== 'CANCELLED' && <ReceiptBadge receipt={order.receipt} />}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link to={`/vendors/${order.vendorId}`} className="font-medium text-foreground hover:underline">{order.vendorName}</Link>
            {' · '}ordered {fmtDate(order.orderDate)}
            {order.expectedDate && ` · expected ${fmtDate(order.expectedDate)}`}
            {order.piNumber && ` · PI ${order.piNumber}${order.piDate ? ` (${fmtDate(order.piDate)})` : ''}`}
          </p>
          {order.status === 'CANCELLED' && order.cancelReason && <p className="mt-1 text-sm text-destructive">Cancelled — {order.cancelReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download()}><FileDown className="h-4 w-4" /> PO PDF</Button>
          {canManage && order.status === 'DRAFT' && <Button onClick={() => void run(() => m.markOrdered.mutateAsync(order.id), `${order.poNumber} marked as ordered`)}><Send className="h-4 w-4" /> Mark as ordered</Button>}
          {canManage && order.status !== 'CANCELLED' && <Button variant="outline" onClick={() => setPayingAdvance(true)}><IndianRupee className="h-4 w-4" /> Pay advance</Button>}
          {canManage && open && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
          {canManage && order.status === 'ORDERED' && !nothingReceived && order.receipt !== 'FULL' && (
            <Button variant="outline" onClick={() => void run(() => m.close.mutateAsync(order.id), `${order.poNumber} closed — the rest is not coming`)}><Lock className="h-4 w-4" /> Close</Button>
          )}
          {canManage && order.status === 'CLOSED' && <Button variant="outline" onClick={() => void run(() => m.reopen.mutateAsync(order.id), `${order.poNumber} reopened`)}><RotateCcw className="h-4 w-4" /> Reopen</Button>}
          {canManage && open && nothingReceived && <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}><Ban className="h-4 w-4" /> Cancel</Button>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <p className="font-medium">{l.description}</p>
                      <p className="text-xs text-muted-foreground">{l.kind === 'SCOOTER' ? 'Scooter' : 'Accessory'} · {l.quantity} ordered</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`tabular-nums ${l.received >= l.quantity ? 'text-emerald-600' : ''}`}>{l.received} / {l.quantity}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(l.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.gstRateBp / 100}%</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaiseExact(l.lineTotal)}</TableCell>
                    <TableCell className="text-right">
                      {order.status === 'ORDERED' && l.kind === 'SCOOTER' && l.received < l.quantity && canAddScooters && (
                        <Button size="sm" variant="outline" onClick={() => receiveScooter(l)}><PackagePlus className="h-4 w-4" /> Receive</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={4} className="text-right text-sm">Before GST {formatPaiseExact(order.subtotal)} · GST {formatPaiseExact(order.gstAmount)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatPaiseExact(order.total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
          {order.status === 'ORDERED' && accessoriesLeft && canManage && (
            <div className="border-t p-3">
              <Button variant="outline" onClick={() => setReceivingAccessories(true)}><PackagePlus className="h-4 w-4" /> Receive accessories</Button>
            </div>
          )}
          {order.status === 'DRAFT' && <p className="border-t p-3 text-xs text-muted-foreground">Mark the order as ordered once it is sent to the vendor — stock is received against it from then on.</p>}
        </Card>

        <div className="space-y-4">
          <DocumentsCard order={order} canManage={canManage} />
          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <h3 className="font-semibold">Advances paid</h3>
              {order.payments.length === 0 ? (
                <p className="text-muted-foreground">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className={p.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''}><span className="font-mono text-xs">{p.paymentNumber}</span> · {fmtDate(p.paidAt)}</span>
                      <span className="tabular-nums">{formatPaise(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">Apply an advance to the scooter and accessory bills from the vendor&apos;s Payments tab once they arrive.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {(order.units.length > 0 || order.accessoryPurchases.length > 0) && (
        <Card className="mt-4">
          <CardContent className="space-y-3 p-4 text-sm">
            <h3 className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Received</h3>
            {order.units.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {order.units.map((u) => (
                  <Link key={u.id} to={`/inventory/${u.id}`} className="rounded-md border px-2 py-1 font-mono text-xs hover:bg-muted">{u.vin}</Link>
                ))}
              </div>
            )}
            {order.accessoryPurchases.map((p) => (
              <p key={p.id} className={p.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''}>
                <span className="font-mono text-xs">{p.purchaseNumber}</span> · {fmtDate(p.purchaseDate)}{p.vendorInvoiceNumber ? ` · bill ${p.vendorInvoiceNumber}` : ''} · {formatPaise(p.total)}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <PurchaseOrderFormDialog open={editing} onOpenChange={setEditing} order={order} />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${order.poNumber}?`}
        description="Nothing was received against it. Any advance paid stays with the vendor, to apply to another bill."
        confirmLabel="Cancel order"
        onConfirm={async (reason) => {
          try {
            await m.cancel.mutateAsync({ id: order.id, body: { reason } });
            toast.success(`${order.poNumber} cancelled`);
          } catch (e) {
            toast.error(apiErrorMessage(e));
            throw e;
          }
        }}
      />
      <PayVendorDialog
        open={payingAdvance}
        onOpenChange={setPayingAdvance}
        vendorId={order.vendorId}
        vendorName={order.vendorName}
        purchaseOrder={{ id: order.id, poNumber: order.poNumber }}
      />
      {receivingLine && <UnitFormDialog open onOpenChange={(o) => !o && setReceivingLine(null)} orderLine={receivingLine} onSaved={() => void qc.invalidateQueries({ queryKey: ['purchase-orders'] })} />}
      <ReceiveAccessoriesDialog open={receivingAccessories} onOpenChange={setReceivingAccessories} order={order} />
      <RecordHistory entityType="PurchaseOrder" entityId={order.id} collapsible />
    </div>
  );
}

function DocumentsCard({ order, canManage }: { order: PurchaseOrderDetailDto; canManage: boolean }): JSX.Element {
  const { addDocument, removeDocument } = usePurchaseOrderMutations();
  const [type, setType] = useState<PurchaseOrderDocumentType>('PROFORMA_INVOICE');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      await addDocument.mutateAsync({ id: order.id, file, type });
      toast.success(`${PURCHASE_ORDER_DOCUMENT_LABEL[type]} attached`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not upload'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <h3 className="font-semibold">PI &amp; documents</h3>
        {order.documents.length === 0 ? (
          <p className="text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {order.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">· {PURCHASE_ORDER_DOCUMENT_LABEL[d.type]}</span>
                </a>
                {canManage && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Remove ${d.fileName}`} onClick={() => void removeDocument.mutateAsync({ id: order.id, documentId: d.id }).catch((e) => toast.error(apiErrorMessage(e)))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Select value={type} onValueChange={(v) => setType(v as PurchaseOrderDocumentType)}>
              <SelectTrigger className="w-48" aria-label="Document type"><SelectValue /></SelectTrigger>
              <SelectContent>{PURCHASE_ORDER_DOCUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{PURCHASE_ORDER_DOCUMENT_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" aria-label="Choose a document" onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant="outline" disabled={addDocument.isPending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {addDocument.isPending ? 'Uploading…' : 'Upload'}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
