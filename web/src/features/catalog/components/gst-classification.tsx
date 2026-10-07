import { ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useTaxClassifications } from '@/features/tax/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Read-only view of a model's GST classification. The catalogue API carries only the classification id;
 * the name and HSN/SAC come from the GST list, which needs settings.view. Without it the user sees
 * "Configured" / "Not configured" only. The sole write path stays Settings → GST Management.
 */
export function useClassificationLookup(enabled: boolean) {
  const { can } = useAuth();
  const canSeeGst = can('settings.view');
  const { data } = useTaxClassifications(true, enabled && canSeeGst);
  return { canSeeGst, find: (id: string | null) => (id ? data?.find((c) => c.id === id) ?? null : null) };
}

export function GstClassificationBadge({ id, lookup }: { id: string | null; lookup: ReturnType<typeof useClassificationLookup> }): JSX.Element {
  if (!id) return <Badge variant="muted">Not configured</Badge>;
  const c = lookup.find(id);
  if (!c) return <Badge variant="success">Configured</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={c.isActive ? 'success' : 'warning'}>{c.name}{c.isActive ? '' : ' (inactive)'}</Badge>
      {c.code && <span className="font-mono text-xs text-muted-foreground">{c.codeType} {c.code}</span>}
    </span>
  );
}

/** The detail-view card: classification, code and treatment as stored, plus the way to change it. */
export function GstClassificationCard({ id, lookup }: { id: string | null; lookup: ReturnType<typeof useClassificationLookup> }): JSX.Element {
  const navigate = useNavigate();
  const c = lookup.find(id);
  return (
    <section className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">GST classification</p>
          {!id && <p className="mt-1 text-sm">Not configured — this model cannot be invoiced under GST until a classification is assigned.</p>}
          {id && !c && <p className="mt-1 text-sm">Configured.{lookup.canSeeGst ? '' : ' Details are visible to users with GST settings access.'}</p>}
          {id && c && (
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Classification</dt><dd>{c.name}{c.isActive ? '' : ' (inactive)'}</dd>
              <dt className="text-muted-foreground">{c.codeType}</dt><dd className="font-mono">{c.code ?? '—'}</dd>
              <dt className="text-muted-foreground">Treatment</dt><dd>{c.treatment.replace('_', ' ').toLowerCase()}</dd>
            </dl>
          )}
        </div>
        {lookup.canSeeGst ? (
          <Button size="sm" variant="outline" onClick={() => navigate('/settings/gst')}><ExternalLink className="h-4 w-4" /> Manage GST</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Managed in Settings → GST Management.</p>
        )}
      </div>
    </section>
  );
}
