import { Archive, Check, Trash2 } from 'lucide-react';
import type { NotificationDto } from '@azad/shared';
import { cn } from '@/lib/utils';
import { categoryMeta, priorityMeta, relativeTime } from '../meta';

export function NotificationItem({
  n,
  onRead,
  onArchive,
  onDelete,
}: {
  n: NotificationDto;
  onRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
}): JSX.Element {
  const cat = categoryMeta[n.type];
  const pri = priorityMeta[n.priority];
  const Icon = cat.icon;
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3', !n.isRead && 'border-accent/30 bg-accent/5')}>
      <div className="relative mt-0.5 shrink-0">
        <span className={cn('absolute -left-1.5 top-0 h-2 w-2 rounded-full', pri.dot)} aria-label={pri.label} />
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm', !n.isRead && 'font-semibold')}>{n.title}</p>
          <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          <span className={cn('font-medium', pri.text)}>{pri.label}</span>
          <span className="text-muted-foreground">· {cat.label}</span>
          <div className="ml-auto flex gap-2 text-muted-foreground">
            {!n.isRead && <button type="button" onClick={onRead} title="Mark read" className="hover:text-foreground"><Check className="h-4 w-4" /></button>}
            <button type="button" onClick={onArchive} title="Archive" className="hover:text-foreground"><Archive className="h-4 w-4" /></button>
            <button type="button" onClick={onDelete} title="Delete" className="hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
