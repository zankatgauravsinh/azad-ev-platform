import { useState } from 'react';
import { History } from 'lucide-react';
import { AUDIT_ACTION_LABEL, AUDIT_SOURCE_LABEL, type AuditEntryDto } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { useAuditHistory } from '../hooks';
import { ChangeList } from './change-list';
import { AuditEntryDialog } from './audit-entry-dialog';
import { auditActionTone, formatWhen } from './audit-meta';

/**
 * Everything that happened to one record — who, when, what changed — newest first, 20 at a time. Used inside a
 * tab (`bare`) or as a card that loads only when opened (`collapsible`).
 */
export function RecordHistory({ entityType, entityId, collapsible = false }: { entityType: string; entityId: string; collapsible?: boolean }): JSX.Element {
  const [open, setOpen] = useState(!collapsible);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  const { data, isLoading, isError } = useAuditHistory(entityType, entityId, page, open);

  const body = !open ? null : isLoading ? (
    <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
  ) : isError ? (
    <p className="text-sm text-muted-foreground">History is not available to you.</p>
  ) : !data?.data.length ? (
    <EmptyState icon={History} title="No history yet" description="Changes to this record will show here." />
  ) : (
    <>
      <ol className="space-y-3" aria-label="History">
        {data.data.map((e) => (
          <li key={e.id}>
            <button type="button" className="w-full rounded-md border p-3 text-left hover:bg-secondary/60" onClick={() => setSelected(e)}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={auditActionTone[e.action]}>{AUDIT_ACTION_LABEL[e.action]}</Badge>
                <span className="font-medium">{e.actor?.name ?? AUDIT_SOURCE_LABEL[e.source]}</span>
                <span className="text-xs text-muted-foreground">{formatWhen(e.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm">{e.summary}</p>
              {e.changes && <div className="mt-2"><ChangeList changes={e.changes} compact /></div>}
              {e.reason && <p className="mt-1 text-xs text-muted-foreground">Reason: {e.reason}</p>}
            </button>
          </li>
        ))}
      </ol>
      {data.meta.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <span className="text-muted-foreground">Page {page} of {data.meta.totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      )}
    </>
  );

  const content = (
    <>
      {body}
      <AuditEntryDialog entry={selected} onOpenChange={(o) => { if (!o) setSelected(null); }} />
    </>
  );
  if (!collapsible) return content;
  return (
    <Card className="mt-4">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" /> History</h3>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide' : 'Show who changed what'}</Button>
        </div>
        {content}
      </CardContent>
    </Card>
  );
}
