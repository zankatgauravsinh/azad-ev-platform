import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { AUDIT_ACTION_LABEL, AUDIT_SOURCE_LABEL, auditEntityLabel, type AuditEntryDto } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChangeList } from './change-list';
import { auditActionTone, deviceOf, formatWhen, recordPath } from './audit-meta';

/** One audit entry in full: who, when, from where, what changed, why. */
export function AuditEntryDialog({ entry, onOpenChange }: { entry: AuditEntryDto | null; onOpenChange: (open: boolean) => void }): JSX.Element {
  const e = entry;
  const path = e ? recordPath(e.entityType, e.entityId) : null;
  const hasMetadata = e && e.metadata && typeof e.metadata === 'object' && Object.keys(e.metadata as object).length > 0;
  return (
    <Dialog open={Boolean(e)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {e && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <Badge variant={auditActionTone[e.action]}>{AUDIT_ACTION_LABEL[e.action]}</Badge>
                <span>{auditEntityLabel(e.entityType)}{e.entityLabel ? ` ${e.entityLabel}` : ''}</span>
                {e.source !== 'USER' && <Badge variant="outline">{AUDIT_SOURCE_LABEL[e.source]}</Badge>}
              </DialogTitle>
              <DialogDescription>{e.summary}</DialogDescription>
            </DialogHeader>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Item label="When" value={formatWhen(e.createdAt)} />
              <Item label="Who" value={e.actor?.name ? `${e.actor.name}${e.actor.role ? ` · ${e.actor.role}` : ''}` : AUDIT_SOURCE_LABEL[e.source]} />
              <Item label="IP address" value={e.ip ?? '—'} mono />
              <Item label="Device" value={deviceOf(e.userAgent) ?? '—'} title={e.userAgent ?? undefined} />
              {e.reason && <Item className="sm:col-span-2" label="Reason" value={e.reason} />}
            </dl>

            {e.changes && Object.keys(e.changes).length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-accent">What changed</h3>
                <ChangeList changes={e.changes} />
              </section>
            )}

            {hasMetadata && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">More details</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-secondary p-3 text-xs">{JSON.stringify(e.metadata, null, 2)}</pre>
              </details>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>Request {e.requestId ?? '—'}</span>
              {path && (
                <Link to={path} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onOpenChange(false)}>
                  Open record <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, value, mono, title, className }: { label: string; value: string; mono?: boolean; title?: string; className?: string }): JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono' : undefined} title={title}>{value}</dd>
    </div>
  );
}
