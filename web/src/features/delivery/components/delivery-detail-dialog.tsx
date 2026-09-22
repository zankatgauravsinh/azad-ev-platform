import { useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, FileDown, ImagePlus, PenLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DELIVERY_CHECKLIST_ITEMS, type DeliveryChecklistDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deliveryApi } from '../api';
import { useDelivery, useDeliveryMutations } from '../hooks';
import { checklistLabel, deliveryStatusLabel, deliveryStatusTone } from '../meta';

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');

export function DeliveryDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'SALES_EXECUTIVE';
  const { data } = useDelivery(id ?? undefined);
  const { schedule, complete, checklist, addPhoto, removePhoto, setSignature } = useDeliveryMutations();

  const [expected, setExpected] = useState('');
  const [pendingDocs, setPendingDocs] = useState('');
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState('');
  const [draft, setDraft] = useState<Partial<DeliveryChecklistDto>>({});
  const photoRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<HTMLInputElement>(null);

  const b = data?.booking;
  const d = data?.delivery;
  const bookingId = b?.bookingId ?? '';

  const doSchedule = async (): Promise<void> => {
    try {
      await schedule.mutateAsync({ id: bookingId, body: { expectedDelivery: expected ? new Date(expected) : undefined, pendingDocuments: pendingDocs || undefined } });
      toast.success('Delivery scheduled');
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const doComplete = async (): Promise<void> => {
    try {
      await complete.mutateAsync({ id: bookingId, body: { notes: notes || undefined, overrideReason: override || undefined, checklist: draft } });
      toast.success('Vehicle delivered');
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const toggleDraft = (key: string, v: boolean): void => setDraft((s) => ({ ...s, [key]: v }));
  const toggleSaved = (key: string, v: boolean): void => { checklist.mutate({ id: bookingId, body: { [key]: v } }); };

  const uploadPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try { await addPhoto.mutateAsync({ id: bookingId, file }); } catch (e) { toast.error(apiErrorMessage(e)); }
    if (photoRef.current) photoRef.current.value = '';
  };
  const uploadSig = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try { await setSignature.mutateAsync({ id: bookingId, file }); toast.success('Signature captured'); } catch (e) { toast.error(apiErrorMessage(e)); }
    if (signRef.current) signRef.current.value = '';
  };
  const downloadNote = async (): Promise<void> => {
    try { saveBlob(await deliveryApi.note(bookingId), `delivery-${b?.code}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!b ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{b.code}</span>
                <Badge variant={deliveryStatusTone[b.status]}>{deliveryStatusLabel[b.status]}</Badge>
                {d && <Button size="sm" variant="outline" className="ml-auto" onClick={downloadNote}><FileDown className="h-4 w-4" /> Delivery note</Button>}
              </DialogTitle>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Customer" value={b.customerName} />
              <Field label="Phone" value={b.customerPhone} />
              <Field label="Vehicle" value={`${b.model} ${b.variant}`} />
              <Field label="VIN" value={b.vin} mono />
              <Field label="Invoice" value={b.invoiceNumber ?? '—'} />
              <Field label="Balance" value={formatPaise(b.balance)} />
              <Field label="Sales exec" value={b.salesExecutive ?? '—'} />
              <Field label="Delivered by" value={d?.deliveredBy ?? '—'} />
              <Field label="Delivered on" value={fmt(b.actualDelivery)} />
            </dl>

            {b.status === 'AWAITING_PAYMENT' && (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">Outstanding balance of {formatPaise(b.balance)}. Delivery can still proceed — this amount stays tracked as due.</p>
            )}

            {/* Not yet delivered → schedule + complete */}
            {!d && (
              <>
                <Section title="Schedule">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1"><Label>Expected date</Label><Input type="date" className="w-44" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
                    <div className="flex-1 space-y-1"><Label>Pending documents</Label><Input value={pendingDocs} onChange={(e) => setPendingDocs(e.target.value)} placeholder={b.pendingDocuments ?? 'e.g. Address proof'} /></div>
                    {canWrite && <Button variant="outline" onClick={doSchedule} disabled={schedule.isPending}><CalendarClock className="h-4 w-4" /> Save</Button>}
                  </div>
                </Section>

                <Section title="Handover checklist">
                  <ChecklistGrid value={draft} disabled={!canWrite} onToggle={toggleDraft} />
                </Section>
                <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional handover notes" /></div>
                <div className="space-y-1"><Label>Override reason (delivering with pending docs)</Label><Input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Optional" /></div>
                {canWrite && (
                  <Button onClick={doComplete} disabled={complete.isPending}>
                    <CheckCircle2 className="h-4 w-4" /> Complete delivery
                  </Button>
                )}
              </>
            )}

            {/* Delivered → editable checklist, photos, signature */}
            {d && (
              <>
                <Section title="Handover checklist">
                  <ChecklistGrid value={d.checklist} disabled={!canWrite} onToggle={toggleSaved} />
                </Section>

                <Section title="Photos">
                  <div className="flex flex-wrap gap-2">
                    {d.photos.map((p) => (
                      <div key={p.id} className="group relative">
                        <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.label ?? 'delivery'} className="h-20 w-20 rounded-md border object-cover" /></a>
                        {canWrite && <button type="button" onClick={() => removePhoto.mutate({ id: bookingId, photoId: p.id })} className="absolute -right-2 -top-2 rounded-full bg-background p-0.5 shadow"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>}
                      </div>
                    ))}
                    {canWrite && (
                      <>
                        <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                        <button type="button" onClick={() => photoRef.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted"><ImagePlus className="h-5 w-5" /> Add</button>
                      </>
                    )}
                  </div>
                </Section>

                <Section title="Customer signature">
                  {d.signatureUrl ? (
                    <img src={d.signatureUrl} alt="signature" className="h-20 rounded-md border bg-white object-contain px-2" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Not captured.</p>
                  )}
                  {canWrite && (
                    <>
                      <input ref={signRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadSig(e.target.files?.[0])} />
                      <Button size="sm" variant="outline" className="mt-2 w-fit" onClick={() => signRef.current?.click()}><PenLine className="h-4 w-4" /> {d.signatureUrl ? 'Replace' : 'Capture'} signature</Button>
                    </>
                  )}
                </Section>

                {d.notes && <p className="text-sm"><span className="text-muted-foreground">Notes: </span>{d.notes}</p>}
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChecklistGrid({ value, disabled, onToggle }: { value: Partial<DeliveryChecklistDto>; disabled: boolean; onToggle: (key: string, v: boolean) => void }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {DELIVERY_CHECKLIST_ITEMS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <Switch checked={Boolean(value[key])} disabled={disabled} onCheckedChange={(v) => onToggle(key, v)} />
          {checklistLabel[key]}
        </label>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-accent">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
