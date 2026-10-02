import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Download, FileText, Plus, Printer, Star, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  INSPECTION_ITEMS, INSPECTION_RESULTS, PAYMENT_MODES, SERVICE_STATUS_TRANSITIONS,
  type InspectionResult, type ServiceJobDto,
} from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { openBlob, printBlob, saveBlob } from '@/lib/download';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentStatusBadge } from '@/features/sales/components/status-badges';
import { useServiceJob, useLabourItems, useServiceInvalidate } from '../hooks';
import { serviceApi, type ServiceDoc } from '../api';
import { ServiceStatusBadge, PriorityBadge } from '../components/badges';

export function ServiceDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useServiceInvalidate();
  const { user } = useAuth();
  const canBill = user?.role === 'OWNER' || user?.role === 'MANAGER';
  // Workflow mutations (status, complaints, parts, labour, inspection, feedback) are OWNER/MANAGER/TECHNICIAN
  // on the backend. SALES_EXECUTIVE has read-only Service access, so these controls are hidden for them.
  const canWork = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'TECHNICIAN';
  const { data: job, isLoading } = useServiceJob(id);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true);
    try { await fn(); await invalidate(); if (ok) toast.success(ok); }
    catch (e) { toast.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };

  if (isLoading || !job) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  const nextStatuses = SERVICE_STATUS_TRANSITIONS[job.status] ?? [];
  const withPdf = async (doc: ServiceDoc, consume: (b: Blob) => void): Promise<void> => {
    try { consume(await serviceApi.pdf(job.id, doc)); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <div className="pb-10">
      <button type="button" onClick={() => navigate('/service')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to service</button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{job.code}</h1>
            <ServiceStatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
            {job.underWarranty && <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">Under warranty</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {titleCase(job.type)} · {job.unit.model} {job.unit.variant} · {job.unit.colour} · <span className="font-mono">{job.unit.vin}</span>
          </p>
          <p className="text-sm text-muted-foreground">{job.customer.name} · {job.customer.phone} · Technician: {job.technician?.name ?? 'Unassigned'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWork && nextStatuses.map((s) => (
            <Button key={s} size="sm" variant={s === 'CANCELLED' ? 'outline' : 'default'} disabled={busy} className={s === 'CANCELLED' ? 'text-destructive' : ''} onClick={() => run(() => serviceApi.changeStatus(job.id, s), `Moved to ${titleCase(s)}`)}>
              {titleCase(s)}
            </Button>
          ))}
        </div>
      </div>

      {/* PDF actions */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(['job-card', 'estimate', 'bill', 'inspection'] as ServiceDoc[]).map((doc) => (
          <div key={doc} className="flex items-center gap-1 rounded-md border px-2 py-1">
            <FileText className="h-4 w-4 text-muted-foreground" /><span className="text-xs font-medium">{titleCase(doc.replace('-', ' '))}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="View" onClick={() => withPdf(doc, openBlob)}><FileText className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Download" onClick={() => withPdf(doc, (b) => saveBlob(b, `${job.code}-${doc}.pdf`))}><Download className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Print" onClick={() => withPdf(doc, printBlob)}><Printer className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Complaints job={job} run={run} busy={busy} canWork={canWork} />
        <Warranty job={job} />
        <Parts job={job} run={run} busy={busy} canWork={canWork} />
        <Labour job={job} run={run} busy={busy} canWork={canWork} />
        <Bill job={job} run={run} busy={busy} canBill={canBill} />
        <Inspection job={job} run={run} busy={busy} canWork={canWork} />
        <Feedback job={job} run={run} busy={busy} canWork={canWork} />
      </div>
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
type Section = { job: ServiceJobDto; run: RunFn; busy: boolean };

function Panel({ title, icon: Icon, children, className }: { title: string; icon: typeof Wrench; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <Card className={className}><CardContent className="p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" /> {title}</h3>
      {children}
    </CardContent></Card>
  );
}

function Complaints({ job, run, busy, canWork }: Section & { canWork: boolean }): JSX.Element {
  const [text, setText] = useState('');
  return (
    <Panel title="Complaints" icon={FileText}>
      <ul className="space-y-1.5 text-sm">
        {job.complaints.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className={c.resolved ? 'text-muted-foreground line-through' : ''}>{c.description} <span className="text-xs text-muted-foreground">[{titleCase(c.priority)}]</span></span>
            {!c.resolved && canWork && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => serviceApi.resolveComplaint(job.id, c.id))}>Resolve</Button>}
          </li>
        ))}
      </ul>
      {canWork && (
        <div className="mt-3 flex gap-2">
          <Input placeholder="Add complaint" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => run(() => serviceApi.addComplaint(job.id, { description: text.trim(), priority: 'MEDIUM' }), 'Complaint added').then(() => setText(''))}><Plus className="h-4 w-4" /></Button>
        </div>
      )}
    </Panel>
  );
}

function Warranty({ job }: { job: ServiceJobDto }): JSX.Element {
  const w = job.warrantyStatus.vehicle;
  return (
    <Panel title="Warranty" icon={FileText}>
      <div className="space-y-1 text-sm">
        <p>Period: <span className="font-medium">{w.months} months</span></p>
        <p>Status: {w.active ? <span className="font-medium text-emerald-600">Active</span> : <span className="text-muted-foreground">Expired / not delivered</span>}</p>
        <p>Ends: {w.endDate ? new Date(w.endDate).toLocaleDateString('en-IN') : '—'}</p>
        {w.active && <p className="text-muted-foreground">{w.daysRemaining} days remaining</p>}
      </div>
    </Panel>
  );
}

function Parts({ job, run, busy, canWork }: Section & { canWork: boolean }): JSX.Element {
  const [q, setQ] = useState('');
  const { data: parts } = useQuery({ queryKey: ['service', 'part-picker', q], queryFn: () => serviceApi.spareParts({ q: q || undefined, pageSize: 6 }), enabled: canWork && q.length > 1 });
  const add = (sparePartId: string, name: string): void => { void run(() => serviceApi.addPart(job.id, { sparePartId, qty: 1, unitCost: 0, unitPrice: 0, warranty: false }), `Added ${name}`); setQ(''); };
  return (
    <Panel title="Spare parts" icon={Wrench} className="lg:col-span-2">
      <ul className="mb-3 divide-y text-sm">
        {job.parts.length === 0 && <li className="py-1 text-muted-foreground">No parts added.</li>}
        {job.parts.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-1.5">
            <span>{p.name} × {p.qty}{p.warranty && <span className="ml-1 text-xs text-accent">(warranty)</span>}</span>
            <span className="flex items-center gap-2"><span className="tabular-nums">{formatPaise(p.lineTotal)}</span>{canWork && <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy} onClick={() => run(() => serviceApi.removePart(job.id, p.id))}><Trash2 className="h-3.5 w-3.5" /></Button>}</span>
          </li>
        ))}
      </ul>
      {canWork && (
        <>
          <Input placeholder="Search spare part to add…" value={q} onChange={(e) => setQ(e.target.value)} />
          {parts && parts.data.length > 0 && (
            <div className="mt-1 rounded-md border">
              {parts.data.map((p) => (
                <button key={p.id} type="button" disabled={busy || p.quantity < 1} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40" onClick={() => add(p.id, p.name)}>
                  <span>{p.name} <span className="text-xs text-muted-foreground">({p.sku})</span></span>
                  <span className="text-xs text-muted-foreground">{p.quantity} in stock · {formatPaise(p.sellingPrice)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Labour({ job, run, busy, canWork }: Section & { canWork: boolean }): JSX.Element {
  const { data: items } = useLabourItems(canWork);
  return (
    <Panel title="Labour" icon={Wrench}>
      <ul className="mb-3 divide-y text-sm">
        {job.labour.length === 0 && <li className="py-1 text-muted-foreground">No labour added.</li>}
        {job.labour.map((l) => (
          <li key={l.id} className="flex items-center justify-between py-1.5">
            <span>{l.description}</span>
            <span className="flex items-center gap-2"><span className="tabular-nums">{formatPaise(l.cost)}</span>{canWork && <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy} onClick={() => run(() => serviceApi.removeLabour(job.id, l.id))}><Trash2 className="h-3.5 w-3.5" /></Button>}</span>
          </li>
        ))}
      </ul>
      {canWork && (
        <Select value="" onValueChange={(v) => run(() => serviceApi.addLabour(job.id, { labourItemId: v, cost: 0 }), 'Labour added')}>
          <SelectTrigger disabled={busy}><SelectValue placeholder="Add labour from catalogue…" /></SelectTrigger>
          <SelectContent>{(items ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} · {formatPaise(l.defaultCost)}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </Panel>
  );
}

function Bill({ job, run, busy, canBill }: Section & { canBill: boolean }): JSX.Element {
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  return (
    <Panel title="Bill" icon={Banknote} className="lg:col-span-2">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <span className="text-muted-foreground">Parts</span><span className="text-right tabular-nums">{formatPaise(job.bill.partsTotal)}</span>
        <span className="text-muted-foreground">Labour</span><span className="text-right tabular-nums">{formatPaise(job.bill.labourTotal)}</span>
        <span className="text-muted-foreground">Discount</span><span className="text-right tabular-nums">− {formatPaise(job.bill.discount)}</span>
        <span className="text-muted-foreground">GST</span><span className="text-right tabular-nums">{formatPaise(job.bill.taxAmount)}</span>
        <span className="border-t pt-1 font-semibold">Total</span><span className="border-t pt-1 text-right font-bold tabular-nums">{formatPaise(job.bill.total)}</span>
        <span className="text-muted-foreground">Paid</span><span className="text-right tabular-nums text-emerald-600">{formatPaise(job.bill.paid)}</span>
        <span className="text-muted-foreground">Balance</span><span className="text-right tabular-nums text-destructive">{formatPaise(job.bill.balance)}</span>
      </div>
      <div className="mt-2"><PaymentStatusBadge status={job.bill.status} /></div>
      {canBill && (
        <div className="mt-4 space-y-3 border-t pt-3">
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label className="text-xs">Discount (₹)</Label><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
            <div className="flex-1"><Label className="text-xs">GST %</Label><Input type="number" min={0} max={100} value={tax} onChange={(e) => setTax(e.target.value)} /></div>
            <Button disabled={busy} onClick={() => run(() => serviceApi.applyBill(job.id, { discount: Math.round(Number(discount) * 100), taxPercentage: Number(tax) }), 'Bill updated')}>Generate bill</Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label className="text-xs">Payment (₹)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Select value={mode} onValueChange={setMode}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent></Select>
            <Button variant="accent" disabled={busy || !amount} onClick={() => run(() => serviceApi.addPayment(job.id, { amount: Math.round(Number(amount) * 100), mode: mode as never }), 'Payment recorded').then(() => setAmount(''))}>Take payment</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Inspection({ job, run, busy, canWork }: Section & { canWork: boolean }): JSX.Element {
  const initial = useMemo(() => {
    const map = new Map(job.inspection.map((i) => [i.item, i]));
    return INSPECTION_ITEMS.map((item) => ({ item, result: (map.get(item)?.result ?? 'GOOD') as InspectionResult, notes: map.get(item)?.notes ?? '' }));
  }, [job.inspection]);
  const [rows, setRows] = useState(initial);
  const set = (i: number, patch: Partial<(typeof rows)[number]>): void => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  return (
    <Panel title="Vehicle inspection" icon={Wrench} className="lg:col-span-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, i) => (
          <div key={r.item} className="flex items-center gap-2 rounded-md border p-2">
            <span className="w-28 shrink-0 text-sm">{r.item}</span>
            <Select value={r.result} onValueChange={(v) => set(i, { result: v as InspectionResult })} disabled={!canWork}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{INSPECTION_RESULTS.map((res) => <SelectItem key={res} value={res}>{titleCase(res)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {canWork && <Button className="mt-3" size="sm" disabled={busy} onClick={() => run(() => serviceApi.saveInspection(job.id, { items: rows.map((r) => ({ item: r.item, result: r.result, notes: r.notes || undefined })) }), 'Inspection saved')}>Save inspection</Button>}
    </Panel>
  );
}

function Feedback({ job, run, busy, canWork }: Section & { canWork: boolean }): JSX.Element {
  const [rating, setRating] = useState(String(job.feedbackRating ?? 5));
  const [note, setNote] = useState(job.feedbackNote ?? '');
  return (
    <Panel title="Customer feedback" icon={Star}>
      {job.feedbackRating ? (
        <p className="mb-2 text-sm">Rated <span className="font-semibold">{job.feedbackRating}★</span>{job.feedbackNote ? ` — ${job.feedbackNote}` : ''}</p>
      ) : !canWork ? <p className="text-sm text-muted-foreground">No feedback recorded.</p> : null}
      {canWork && (
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Rating</Label>
            <Select value={rating} onValueChange={setRating}><SelectTrigger className="w-20"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}★</SelectItem>)}</SelectContent></Select>
          </div>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => run(() => serviceApi.feedback(job.id, { rating: Number(rating), note: note || undefined }), 'Feedback saved')}>Save</Button>
        </div>
      )}
    </Panel>
  );
}
