import { useState } from 'react';
import { CheckCircle2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { GST_RETURN_LABEL, type GstFilingDto, type GstReturnType } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGstFilingMutations, useGstFilings } from '../hooks';

const todayInput = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Money figures in the "changed since filing" list are paise; counts are plain numbers. */
const show = (label: string, v: string): string => (/value|GST|ITC/i.test(label) ? formatPaiseExact(v) : v);

/**
 * GSTR-1 and GSTR-3B of the month: filed or not, with the ARN and date. Marking a return filed freezes its figures
 * and locks the month's documents; unlocking needs a reason. Anything that changes the month after filing is listed.
 */
export function GstFilingPanel({ period, periodLabel, canManage, errors }: { period: string; periodLabel: string; canManage: boolean; errors: number }): JSX.Element {
  const { data, isLoading } = useGstFilings(period);
  const [filing, setFiling] = useState<GstReturnType | null>(null);
  const [unlocking, setUnlocking] = useState<GstReturnType | null>(null);
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.map((f) => (
        <FilingCard key={f.returnType} f={f} canManage={canManage} onFile={() => setFiling(f.returnType)} onUnlock={() => setUnlocking(f.returnType)} />
      ))}
      {filing && <MarkFiledDialog period={period} periodLabel={periodLabel} returnType={filing} errors={errors} onClose={() => setFiling(null)} />}
      {unlocking && <UnlockDialog period={period} periodLabel={periodLabel} returnType={unlocking} onClose={() => setUnlocking(null)} />}
    </div>
  );
}

function FilingCard({ f, canManage, onFile, onUnlock }: { f: GstFilingDto; canManage: boolean; onFile: () => void; onUnlock: () => void }): JSX.Element {
  const filed = f.status === 'FILED';
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{GST_RETURN_LABEL[f.returnType]}</h3>
          <Badge variant={filed ? 'success' : f.status === 'UNLOCKED' ? 'warning' : 'muted'}>{filed ? 'Filed — month locked' : f.status === 'UNLOCKED' ? 'Unlocked' : 'Not filed'}</Badge>
        </div>
        {filed && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Filed on</dt><dd>{f.filedOn ? new Date(f.filedOn).toLocaleDateString('en-IN') : '—'}{f.filedBy ? ` · ${f.filedBy}` : ''}</dd>
            <dt className="text-muted-foreground">ARN</dt><dd className="font-mono">{f.arn ?? '—'}</dd>
            {f.notes && <><dt className="text-muted-foreground">Notes</dt><dd>{f.notes}</dd></>}
          </dl>
        )}
        {f.status === 'UNLOCKED' && f.unlockReason && <p className="text-sm text-muted-foreground">Unlocked: {f.unlockReason}</p>}
        {filed && (f.changesSinceFiling.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Matches the return as filed</p>
        ) : (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="mb-1 font-medium">Changed since filing — report the difference in a later month:</p>
            <ul className="space-y-0.5">{f.changesSinceFiling.map((c) => <li key={c.label}>{c.label}: {show(c.label, c.filed)} → {show(c.label, c.now)}</li>)}</ul>
          </div>
        ))}
        {canManage && (
          <div className="flex justify-end">
            {filed ? (
              <Button variant="outline" size="sm" onClick={onUnlock}><Unlock className="h-4 w-4" /> Unlock</Button>
            ) : (
              <Button size="sm" onClick={onFile}><Lock className="h-4 w-4" /> Mark filed</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarkFiledDialog({ period, periodLabel, returnType, errors, onClose }: { period: string; periodLabel: string; returnType: GstReturnType; errors: number; onClose: () => void }): JSX.Element {
  const { markFiled } = useGstFilingMutations();
  const [arn, setArn] = useState('');
  const [filedOn, setFiledOn] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const submit = async (): Promise<void> => {
    try {
      await markFiled.mutateAsync({ period, returnType, arn: arn.trim(), filedOn, notes: notes.trim() || undefined });
      toast.success(`${GST_RETURN_LABEL[returnType]} for ${periodLabel} marked filed`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not mark the return filed'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {GST_RETURN_LABEL[returnType]} for {periodLabel} filed</DialogTitle>
          <DialogDescription>Its figures are frozen as they are now, and the month’s {returnType === 'GSTR1' ? 'invoices and service bills' : 'purchase bills'} can no longer be changed.</DialogDescription>
        </DialogHeader>
        {errors > 0 && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{errors} issue{errors === 1 ? '' : 's'} still marked as errors this month — check the Issues tab first.</p>}
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="gst-arn">ARN (from the portal)</Label><Input id="gst-arn" maxLength={15} className="font-mono uppercase" value={arn} onChange={(e) => setArn(e.target.value.toUpperCase())} placeholder="15 letters and digits" /></div>
          <div className="space-y-1.5"><Label htmlFor="gst-filed-on">Filed on</Label><Input id="gst-filed-on" type="date" max={todayInput()} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="gst-notes">Notes</Label><Textarea id="gst-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — e.g. filed by the CA" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={markFiled.isPending || (arn.length > 0 && arn.length !== 15)}>Mark filed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({ period, periodLabel, returnType, onClose }: { period: string; periodLabel: string; returnType: GstReturnType; onClose: () => void }): JSX.Element {
  const { unlock } = useGstFilingMutations();
  const [reason, setReason] = useState('');
  const submit = async (): Promise<void> => {
    try {
      await unlock.mutateAsync({ period, returnType, reason: reason.trim() });
      toast.success(`${GST_RETURN_LABEL[returnType]} for ${periodLabel} unlocked`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not unlock the return'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock {GST_RETURN_LABEL[returnType]} for {periodLabel}</DialogTitle>
          <DialogDescription>The month’s documents can be changed again. A return already filed on the portal can’t be changed there — corrections go in a later month’s return.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="gst-unlock-reason">Reason</Label><Textarea id="gst-unlock-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the month is being reopened" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={unlock.isPending || reason.trim().length < 5}>Unlock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
