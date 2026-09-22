import { useNavigate } from 'react-router-dom';
import { ExternalLink, User } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomer } from '../hooks';
import { LeadStatusBadge } from './lead-status-badge';

/**
 * Focused, read-only customer summary shown as a popup from another record's page
 * (e.g. a booking). Reuses useCustomer — no duplicated data logic — and links out
 * to the full customer page for the complete profile and actions.
 */
export function CustomerDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const navigate = useNavigate();
  const { data: c, isLoading, isError, error } = useCustomer(id ?? undefined);

  const openFull = (): void => {
    if (!id) return;
    onOpenChange(false);
    navigate(`/customers/${id}`);
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        {isError ? (
          <p className="py-10 text-center text-sm text-destructive">{apiErrorMessage(error, 'Could not load customer')}</p>
        ) : isLoading || !c ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                {c.name}
                <LeadStatusBadge status={c.leadStatus} />
              </DialogTitle>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Mobile" value={c.phone} mono />
              <Field label="Alternate" value={c.altPhone ?? '—'} mono />
              <Field label="Email" value={c.email ?? '—'} />
              <Field label="City" value={c.city ?? '—'} />
              <Field label="State" value={c.state ?? '—'} />
              <Field label="Assigned to" value={c.assignedTo?.name ?? '—'} />
              <Field label="Address" value={c.address ?? '—'} className="col-span-2 sm:col-span-3" />
            </dl>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openFull}><ExternalLink className="h-4 w-4" /> Open full profile</Button>
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
