import { useState } from 'react';
import { FileDown, Plus, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { warrantyApi } from '../api';
import { useWarranty, useWarrantyMutations } from '../hooks';
import { claimTone, expiryLabel, expiryTone, freeServiceTone, warrantyTone } from '../meta';
import { CreateClaimDialog } from './create-claim-dialog';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

export function WarrantyDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { can } = useAuth();
  const canManageClaims = can('claims.manage'); // new claim + approve/reject/complete (warranty-claims)
  const canUpdateWarranty = can('warranty.update'); // free-service completion
  const canCancel = can('warranty.cancel');
  const { data } = useWarranty(id ?? undefined);
  const { cancel, completeFreeService, updateClaim } = useWarrantyMutations();
  const [claimOpen, setClaimOpen] = useState(false);

  const w = data?.warranty;

  const download = async (): Promise<void> => {
    if (!w) return;
    try {
      saveBlob(await warrantyApi.certificate(w.id), `warranty-${w.warrantyNumber}.pdf`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  const doCancel = async (): Promise<void> => {
    if (!w) return;
    try { await cancel.mutateAsync(w.id); toast.success('Warranty cancelled'); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        {!w ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{w.warrantyNumber}</span>
                <Badge variant={warrantyTone[w.status]}>{titleCase(w.status)}</Badge>
                {w.status === 'ACTIVE' && <Badge variant={expiryTone(w.daysToExpiry)}>{expiryLabel(w.daysToExpiry)}</Badge>}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={download}><FileDown className="h-4 w-4" /> Certificate</Button>
              {canManageClaims && w.status !== 'CANCELLED' && <Button size="sm" onClick={() => setClaimOpen(true)}><Plus className="h-4 w-4" /> New claim</Button>}
              {canCancel && w.status !== 'CANCELLED' && <Button size="sm" variant="outline" onClick={doCancel} disabled={cancel.isPending}><ShieldX className="h-4 w-4" /> Cancel</Button>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Customer" value={w.customerName} />
              <Field label="Vehicle" value={`${w.model} ${w.variant}`} />
              <Field label="VIN" value={w.vin} mono />
              <Field label="Motor no." value={w.motorNumber ?? '—'} mono />
              <Field label="Battery no." value={w.batteryNumber ?? '—'} mono />
              <Field label="Invoice" value={w.invoiceNumber ?? '—'} />
              <Field label="Purchased" value={fmt(w.purchaseDate)} />
              <Field label="Valid from" value={fmt(w.startDate)} />
              <Field label="Valid until" value={fmt(w.endDate)} />
            </dl>

            <Section title="Coverage">
              <Table>
                <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Status</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.coverage.map((c) => (
                    <TableRow key={c.item}>
                      <TableCell>{c.label}</TableCell>
                      <TableCell><Badge variant={c.covered ? 'success' : 'muted'}>{c.covered ? 'Covered' : 'Excluded'}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{c.remarks ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <Section title="Free services">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead>Technician</TableHead>{canUpdateWarranty && <TableHead />}</TableRow></TableHeader>
                <TableBody>
                  {data.freeServices.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.serviceNumber}</TableCell>
                      <TableCell>{fmt(f.dueDate)}</TableCell>
                      <TableCell><Badge variant={freeServiceTone[f.status]}>{titleCase(f.status)}</Badge></TableCell>
                      <TableCell>{f.technicianName ?? '—'}</TableCell>
                      {canUpdateWarranty && (
                        <TableCell className="text-right">
                          {f.status === 'PENDING' && (
                            <Button size="sm" variant="outline" onClick={() => completeFreeService.mutate({ id: f.id, status: 'COMPLETED' })}>Mark done</Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {data.claims.length > 0 && (
              <Section title="Claims">
                <Table>
                  <TableHeader><TableRow><TableHead>Claim</TableHead><TableHead>Complaint</TableHead><TableHead>Cost</TableHead><TableHead>Status</TableHead>{canManageClaims && <TableHead />}</TableRow></TableHeader>
                  <TableBody>
                    {data.claims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                        <TableCell className="max-w-[10rem] truncate">{c.complaint}</TableCell>
                        <TableCell>{formatPaise(c.claimCost)}</TableCell>
                        <TableCell><Badge variant={claimTone[c.status]}>{titleCase(c.status)}</Badge></TableCell>
                        {canManageClaims && (
                          <TableCell className="space-x-1 text-right">
                            {c.status === 'PENDING' && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => updateClaim.mutate({ id: c.id, status: 'APPROVED' })}>Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => updateClaim.mutate({ id: c.id, status: 'REJECTED' })}>Reject</Button>
                              </>
                            )}
                            {c.status === 'APPROVED' && (
                              <Button size="sm" variant="outline" onClick={() => updateClaim.mutate({ id: c.id, status: 'COMPLETED' })}>Complete</Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )}

            <Section title="Timeline">
              <ol className="space-y-3 border-l pl-4">
                {data.timeline.map((t, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
                    <p className="font-medium">{t.title}</p>
                    {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                    <p className="text-xs text-muted-foreground">{fmt(t.at)}</p>
                  </li>
                ))}
              </ol>
            </Section>

            {w && <CreateClaimDialog open={claimOpen} onOpenChange={setClaimOpen} warrantyId={w.id} warrantyNumber={w.warrantyNumber} />}
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

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-accent">{title}</h3>
      {children}
    </section>
  );
}
