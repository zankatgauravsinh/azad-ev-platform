import { useRef, useState } from 'react';
import { FileDown, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EXPENSE_ATTACHMENT_TYPES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { expensesApi } from '../api';
import { useExpense, useFinanceMutations } from '../hooks';
import { expenseStatusTone, payMethodLabel } from '../meta';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');
const kb = (b: number): string => `${Math.max(1, Math.round(b / 1024))} KB`;

export function ExpenseDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { can } = useAuth();
  const canManage = can('expenses.manage'); // submit / approve / settle / attachments (all expenses endpoints)
  const { data: e } = useExpense(id ?? undefined);
  const { submitExpense, setExpenseStatus, settleExpense, addAttachment, removeAttachment } = useFinanceMutations();
  const [attType, setAttType] = useState('INVOICE');
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file || !e) return;
    try { await addAttachment.mutateAsync({ id: e.id, file, type: attType }); toast.success('Attachment added'); }
    catch (err) { toast.error(apiErrorMessage(err)); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const voucher = async (): Promise<void> => {
    if (!e) return;
    try { saveBlob(await expensesApi.voucher(e.id), `expense-${e.expenseNumber}.pdf`); } catch (err) { toast.error(apiErrorMessage(err)); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!e ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{e.expenseNumber}</span>
                <Badge variant={expenseStatusTone[e.status]}>{titleCase(e.status)}</Badge>
                {!e.paid && <Badge variant="warning">Unpaid</Badge>}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={voucher}><FileDown className="h-4 w-4" /> Voucher</Button>
              {canManage && e.status === 'DRAFT' && <Button size="sm" onClick={() => submitExpense.mutate(e.id)}>Submit for approval</Button>}
              {canManage && e.status === 'PENDING' && <>
                <Button size="sm" onClick={() => setExpenseStatus.mutate({ id: e.id, status: 'APPROVED' })}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setExpenseStatus.mutate({ id: e.id, status: 'REJECTED' })}>Reject</Button>
              </>}
              {canManage && !e.paid && e.status !== 'REJECTED' && <Button size="sm" variant="outline" onClick={() => settleExpense.mutate(e.id)}>Mark paid</Button>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Date" value={fmt(e.expenseDate)} />
              <Field label="Category" value={e.category} />
              <Field label="Vendor" value={e.vendorName ?? '—'} />
              <Field label="Amount" value={formatPaise(e.amount)} />
              <Field label="GST" value={formatPaise(e.gstAmount)} />
              <Field label="Total" value={formatPaise(e.total)} />
              <Field label="Payment" value={payMethodLabel[e.paymentMethod]} />
              <Field label="Reference" value={e.referenceNumber ?? '—'} />
              <Field label="Due" value={e.dueDate ? fmt(e.dueDate) : '—'} />
            </dl>
            {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-accent">Attachments</h3>
              {e.attachments.length === 0 && <p className="text-sm text-muted-foreground">No attachments.</p>}
              <ul className="space-y-1">
                {e.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <a href={a.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{a.fileName}</a>
                    <Badge variant="muted">{titleCase(a.type)}</Badge>
                    <span className="text-xs text-muted-foreground">{kb(a.sizeBytes)}</span>
                    {canManage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => removeAttachment.mutate({ id: e.id, attachmentId: a.id })}><Trash2 className="h-4 w-4" /></Button>}
                  </li>
                ))}
              </ul>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={attType} onValueChange={setAttType}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{EXPENSE_ATTACHMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
                  </Select>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(ev) => onPick(ev.target.files?.[0])} />
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={addAttachment.isPending}><Paperclip className="h-4 w-4" /> Attach file</Button>
                  <span className="text-xs text-muted-foreground">Invoice / GST bill / photo / PDF · max 10 MB</span>
                </div>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
