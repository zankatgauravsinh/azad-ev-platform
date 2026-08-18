import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, Search, X } from 'lucide-react';
import type { NotificationDto, NotificationType } from '@azad/shared';
import { NOTIFICATION_TYPES } from '@azad/shared';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications, useNotificationActions, useUnreadCount } from '../hooks';
import { categoryMeta, dateGroup } from '../meta';
import { NotificationItem } from './notification-item';

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'] as const;

export function NotificationBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NotificationType | undefined>();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState('');
  const search = useDebounce(q, 300);

  const { data: unread } = useUnreadCount();
  const actions = useNotificationActions();
  const filters = useMemo(
    () => ({ type, unread: unreadOnly ? ('true' as const) : undefined, q: search || undefined }),
    [type, unreadOnly, search],
  );
  const list = useNotifications(filters);

  // Freshen notifications whenever the drawer opens.
  const refresh = actions.refresh.mutate;
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Android hardware back / Escape closes the drawer (see lib/native + app-shell).
  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('android-back', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('android-back', close); window.removeEventListener('keydown', onKey); };
  }, [open]);

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !open) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [open, list.hasNextPage, list.isFetchingNextPage, list]);

  const items: NotificationDto[] = list.data?.pages.flatMap((p) => p.data) ?? [];
  const grouped = GROUP_ORDER.map((g) => ({ group: g, rows: items.filter((n) => dateGroup(n.createdAt) === g) })).filter((g) => g.rows.length > 0);
  const badge = unread?.total ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Notifications${badge ? ` (${badge} unread)` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50" data-mobile-drawer="open">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="pt-safe absolute inset-y-0 right-0 flex w-full flex-col border-l bg-card shadow-xl sm:w-[400px]">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                <span className="font-semibold">Notifications</span>
                {badge > 0 && <span className="rounded-full bg-destructive/10 px-1.5 text-xs font-medium text-destructive">{badge}</span>}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => actions.markAllRead.mutate()} disabled={badge === 0} title="Mark all read"><CheckCheck className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} title="Close"><X className="h-4 w-4" /></Button>
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-2 border-b px-4 py-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notifications" className="pl-8" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip active={!type} onClick={() => setType(undefined)}>All</FilterChip>
                {NOTIFICATION_TYPES.map((t) => (
                  <FilterChip key={t} active={type === t} onClick={() => setType(type === t ? undefined : t)}>{categoryMeta[t].label}</FilterChip>
                ))}
                <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread</FilterChip>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {list.isLoading ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
              ) : items.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  You're all caught up.
                </div>
              ) : (
                grouped.map(({ group, rows }) => (
                  <div key={group}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
                    <div className="space-y-2">
                      {rows.map((n) => (
                        <NotificationItem
                          key={n.id}
                          n={n}
                          onRead={() => actions.markRead.mutate(n.id)}
                          onArchive={() => actions.archive.mutate(n.id)}
                          onDelete={() => actions.remove.mutate(n.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div ref={sentinel} className="h-1" />
              {list.isFetchingNextPage && <Skeleton className="h-16" />}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', active ? 'border-accent bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-muted')}
    >
      {children}
    </button>
  );
}
