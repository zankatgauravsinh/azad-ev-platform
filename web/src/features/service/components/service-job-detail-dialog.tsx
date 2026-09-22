import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PaymentStatusBadge } from '@/features/sales/components/status-badges';
import { useServiceJob } from '../hooks';
import { ServiceStatusBadge, PriorityBadge } from './badges';

/**
 * Focused, read-only service job (job card) summary shown as a popup from the
 * customer detail. Reuses useServiceJob and links to the full job-card page.
 */
export function ServiceJobDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const navigate = useNavigate();
  const { data: j, isLoading, isError, error } = useServiceJob(id ?? undefined);

  const openFull = (): void => {
    if (!id) return;
    onOpenChange(false);
    navigate(`/service/${id}`);
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        {isError ? (
          <p className="py-10 text-center text-sm text-destructive">{apiErrorMessage(error, 'Could not load service job')}</p>
        ) : isLoading || !j ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{j.code}</span>
                <ServiceStatusBadge status={j.status} />
                <PriorityBadge priority={j.priority} />
              </DialogTitle>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Type" value={titleCase(j.type)} />
              <Field label="Customer" value={j.customer.name} />
              <Field label="Vehicle" value={`${j.unit.model} ${j.unit.variant}`} />
              <Field label="VIN" value={j.unit.vin} mono />
              <Field label="Technician" value={j.technician?.name ?? '—'} />
              <Field label="Complaints" value={j.complaints.map((c) => c.description).join('; ') || '—'} className="col-span-2 sm:col-span-3" />
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Bill total <span className="font-medium tabular-nums text-foreground">{formatPaise(j.bill.total)}</span> · Balance <span className="font-medium tabular-nums text-destructive">{formatPaise(j.bill.balance)}</span></span>
              <PaymentStatusBadge status={j.bill.status} />
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openFull}><ExternalLink className="h-4 w-4" /> Open job card</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }): JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
