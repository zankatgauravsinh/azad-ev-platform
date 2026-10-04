import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, ClipboardCheck, ExternalLink, ThumbsUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { titleCase } from '@/lib/labels';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useReturn, useReturnMutations } from '../hooks';
import { dispositionLabel, dispositionTone, returnStatusLabel, returnStatusTone } from '../meta';
import { CompleteReturnDialog } from './complete-return-dialog';

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

type Action = 'inspect' | 'reject' | 'cancel' | 'approve' | 'complete' | null;

export function ReturnDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Each return action is an independent backend permission — do not collapse into one flag.
  const canInspect = can('returns.inspect');
  const canApprove = can('returns.approve');
  const canComplete = can('returns.complete');
  const canReject = can('returns.reject');
  const canCancel = can('returns.cancel');
  const { data: w, isLoading, isError, error } = useReturn(id ?? undefined);
  const { inspect, approve, reject, cancel } = useReturnMutations();
  const [action, setAction] = useState<Action>(null);

  const go = (to: string): void => { onOpenChange(false); navigate(to); };

  const doApprove = async (): Promise<void> => {
    if (!w) return;
    // Self-approval is rejected server-side (403); surface it cleanly, never bypass it.
    try { await approve.mutateAsync(w.id); toast.success('Return approved'); }
    catch (e) { toast.error(apiErrorMessage(e, 'Could not approve')); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        {isError ? (
          <p className="py-10 text-center text-sm text-destructive">{apiErrorMessage(error, 'Could not load the return')}</p>
        ) : isLoading || !w ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{w.returnNumber}</span>
                <Badge variant={returnStatusTone[w.status]}>{returnStatusLabel[w.status]}</Badge>
                {w.disposition && <Badge variant={dispositionTone[w.disposition]}>{dispositionLabel[w.disposition]}</Badge>}
              </DialogTitle>
              <DialogDescription>Post-delivery vehicle return · {w.customerName} · {w.vin}</DialogDescription>
            </DialogHeader>

            {/* State- and permission-aware actions. Each gate is independent; status conditions preserve the
                backend state machine, and the API remains authoritative (incl. the requester≠approver rule). */}
            {(canInspect || canApprove || canComplete || canReject || canCancel) && (
              <div className="flex flex-wrap gap-2">
                {canInspect && w.status === 'REQUESTED' && <Button size="sm" onClick={() => setAction('inspect')}><ClipboardCheck className="h-4 w-4" /> Record inspection</Button>}
                {canApprove && w.status === 'INSPECTION' && <Button size="sm" onClick={() => setAction('approve')}><ThumbsUp className="h-4 w-4" /> Approve</Button>}
                {canComplete && w.status === 'APPROVED' && <Button size="sm" onClick={() => setAction('complete')}><CheckCircle2 className="h-4 w-4" /> Complete return</Button>}
                {canReject && (w.status === 'REQUESTED' || w.status === 'INSPECTION') && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setAction('reject')}><XCircle className="h-4 w-4" /> Reject</Button>}
                {canCancel && (w.status === 'REQUESTED' || w.status === 'INSPECTION' || w.status === 'APPROVED') && <Button size="sm" variant="outline" onClick={() => setAction('cancel')}><Ban className="h-4 w-4" /> Cancel</Button>}
              </div>
            )}

            {/* Approval trail */}
            <Section title="Approval trail">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <Field label="Requested by" value={w.requestedByName ?? '—'} />
                <Field label="Requested at" value={fmt(w.requestedAt)} />
                <Field label="Inspection" value={w.inspectionOk === null ? 'Pending' : w.inspectionOk ? 'Passed' : 'Issues noted'} />
                <Field label="Inspected by" value={w.inspectedByName ?? '—'} />
                <Field label="Inspected at" value={fmt(w.inspectedAt)} />
                <Field label="Approved by" value={w.approvedByName ?? '—'} />
                <Field label="Approved at" value={fmt(w.approvedAt)} />
                <Field label="Completed at" value={fmt(w.completedAt)} />
                <Field label="Status" value={returnStatusLabel[w.status]} />
              </dl>
              {w.inspectionNotes && <p className="mt-2 text-sm"><span className="text-muted-foreground">Inspection notes: </span>{w.inspectionNotes}</p>}
              <p className="mt-1 text-sm"><span className="text-muted-foreground">Reason: </span>{w.reason}</p>
              {w.rejectionReason && <p className="mt-1 text-sm text-destructive">Rejected/withdrawn: {w.rejectionReason}</p>}
            </Section>

            {/* Vehicle / customer / sale */}
            <Section title="Vehicle & sale">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <Field label="Customer" value={w.customerName} />
                <Field label="VIN" value={w.vin} mono />
                <Field label="Booking" value={w.bookingCode} mono />
                <Field label="Invoice" value={w.invoiceNumber ?? '—'} mono />
                <Field label="Sale total" value={formatPaise(w.saleTotal)} />
                <Field label="Amount paid" value={formatPaise(w.amountPaid)} />
              </dl>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => go(`/customers/${w.customerId}`)}><ExternalLink className="h-4 w-4" /> Open customer</Button>
                <Button size="sm" variant="outline" onClick={() => go(`/bookings/${w.bookingId}`)}><ExternalLink className="h-4 w-4" /> Open booking</Button>
              </div>
            </Section>

            {/* Financial outcome (completed) */}
            {(w.status === 'COMPLETED' || w.creditNote || w.refunds.length > 0) && (
              <Section title="Financial outcome">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <Field label="Deduction" value={Number(w.deductionAmount) > 0 ? formatPaise(w.deductionAmount) : '—'} />
                  <Field label="Deduction reason" value={w.deductionReason ?? '—'} />
                  <Field label="Credit note" value={w.creditNote?.creditNoteNumber ?? '—'} mono />
                  {w.creditNote && <Field label="Credit note total" value={formatPaise(w.creditNote.total)} />}
                  {w.refunds.map((r) => (
                    <Field key={r.id} label={`Refund ${r.refundNumber}`} value={`${formatPaise(r.amount)} · ${titleCase(r.method)}`} />
                  ))}
                </dl>
              </Section>
            )}

            {/* Action sub-dialogs */}
            <InspectDialog open={action === 'inspect'} onClose={() => setAction(null)} busy={inspect.isPending} onSubmit={async (ok, notes) => {
              try { await inspect.mutateAsync({ id: w.id, body: { inspectionOk: ok, notes } }); toast.success('Inspection recorded'); setAction(null); }
              catch (e) { toast.error(apiErrorMessage(e)); }
            }} />
            <ReasonDialog open={action === 'reject'} title={`Reject return ${w.returnNumber}?`} description="The vehicle stays delivered. A reason is required." confirmLabel="Reject" destructive required busy={reject.isPending} onClose={() => setAction(null)} onSubmit={async (reason) => {
              try { await reject.mutateAsync({ id: w.id, body: { reason } }); toast.success('Return rejected'); setAction(null); }
              catch (e) { toast.error(apiErrorMessage(e)); }
            }} />
            <ReasonDialog open={action === 'cancel'} title={`Cancel return ${w.returnNumber}?`} description="Withdraws this return before completion." confirmLabel="Cancel return" destructive busy={cancel.isPending} onClose={() => setAction(null)} onSubmit={async (reason) => {
              try { await cancel.mutateAsync({ id: w.id, body: { reason: reason || undefined } }); toast.success('Return cancelled'); setAction(null); }
              catch (e) { toast.error(apiErrorMessage(e)); }
            }} />
            <ConfirmDialog open={action === 'approve'} onOpenChange={(o) => !o && setAction(null)} title={`Approve return ${w.returnNumber}?`} description="You cannot approve a return you requested — another owner/manager must." confirmLabel="Approve" onConfirm={doApprove} />
            <CompleteReturnDialog ret={w} open={action === 'complete'} onOpenChange={(o) => !o && setAction(null)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InspectDialog({ open, onClose, onSubmit, busy }: { open: boolean; onClose: () => void; onSubmit: (ok: boolean, notes?: string) => Promise<void>; busy: boolean }): JSX.Element {
  const [ok, setOk] = useState(true);
  const [notes, setNotes] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader><DialogTitle>Record inspection</DialogTitle><DialogDescription>Capture the inspection outcome before approval.</DialogDescription></DialogHeader>
        <label className="flex items-center gap-2 text-sm"><Switch checked={ok} onCheckedChange={setOk} /> Inspection passed</label>
        <div className="space-y-1"><Label>Notes (optional)</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition, damage, accessories…" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSubmit(ok, notes.trim() || undefined)}>Save inspection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ open, title, description, confirmLabel, destructive, required, busy, onClose, onSubmit }: { open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; required?: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label>Reason {required && <span className="text-destructive">*</span>}</Label><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button variant={destructive ? 'outline' : 'default'} className={destructive ? 'text-destructive' : ''} disabled={busy || (required && !reason.trim())} onClick={() => onSubmit(reason.trim())}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <section className="space-y-2"><h3 className="text-sm font-semibold text-accent">{title}</h3>{children}</section>;
}
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd></div>;
}
