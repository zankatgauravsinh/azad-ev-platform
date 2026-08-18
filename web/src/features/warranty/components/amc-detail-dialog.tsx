import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { amcApi } from '../api';
import { useAmcPlan, useWarrantyMutations } from '../hooks';
import { amcTone, expiryLabel, expiryTone } from '../meta';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

export function AmcDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'TECHNICIAN';
  const { data: a } = useAmcPlan(id ?? undefined);
  const { recordVisit } = useWarrantyMutations();
  const [workDone, setWorkDone] = useState('');
  const [amount, setAmount] = useState('');
  const [covered, setCovered] = useState(true);

  const download = async (): Promise<void> => {
    if (!a) return;
    try { saveBlob(await amcApi.agreement(a.id), `amc-${a.amcNumber}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const submitVisit = async (): Promise<void> => {
    if (!a) return;
    if (!workDone.trim()) { toast.error('Describe the work done'); return; }
    try {
      await recordVisit.mutateAsync({ id: a.id, workDone: workDone.trim(), amount: amount ? Math.round(Number(amount) * 100) : 0, coveredUnderAmc: covered });
      toast.success('Visit recorded');
      setWorkDone(''); setAmount(''); setCovered(true);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!a ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{a.amcNumber}</span>
                <Badge variant={amcTone[a.status]}>{titleCase(a.status)}</Badge>
                <Badge variant="accent">{titleCase(a.planType)}</Badge>
                {a.status === 'ACTIVE' && <Badge variant={expiryTone(a.daysToExpiry)}>{expiryLabel(a.daysToExpiry)}</Badge>}
              </DialogTitle>
            </DialogHeader>

            <Button size="sm" variant="outline" className="w-fit" onClick={download}><FileDown className="h-4 w-4" /> Agreement</Button>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Customer" value={a.customerName} />
              <Field label="Vehicle" value={a.model} />
              <Field label="VIN" value={a.vin} mono />
              <Field label="Valid from" value={fmt(a.startDate)} />
              <Field label="Valid until" value={fmt(a.endDate)} />
              <Field label="Value" value={formatPaise(a.price)} />
              <Field label="Visits" value={`${a.visitsUsed} / ${a.visitsIncluded} used`} />
              <Field label="Remaining" value={String(a.visitsRemaining)} />
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-accent">Visits</h3>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Date</TableHead><TableHead>Work done</TableHead><TableHead>Amount</TableHead><TableHead>AMC</TableHead></TableRow></TableHeader>
                <TableBody>
                  {a.visits.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No visits yet</TableCell></TableRow>}
                  {a.visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>{v.visitNumber}</TableCell>
                      <TableCell>{fmt(v.visitDate)}</TableCell>
                      <TableCell className="max-w-[12rem] truncate">{v.workDone}</TableCell>
                      <TableCell>{formatPaise(v.amount)}</TableCell>
                      <TableCell>{v.coveredUnderAmc ? <Badge variant="success">Yes</Badge> : <Badge variant="muted">No</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            {canWrite && a.status === 'ACTIVE' && (
              <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">Record a visit</h3>
                <div className="space-y-1"><Label>Work done</Label><Textarea rows={2} value={workDone} onChange={(e) => setWorkDone(e.target.value)} /></div>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1"><Label>Extra charge (₹)</Label><Input type="number" min={0} className="w-32" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={covered} onCheckedChange={setCovered} /> Counts against AMC</label>
                  <Button className="ml-auto" onClick={submitVisit} disabled={recordVisit.isPending}>Add visit</Button>
                </div>
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
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
