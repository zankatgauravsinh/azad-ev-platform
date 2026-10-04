import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, PERMISSION_KEYS, PERMISSION_MODULES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { permissionModuleLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRole, useRoleMutations } from '../hooks';

const GROUPS = PERMISSION_MODULES.map((module) => ({ module, perms: PERMISSIONS.filter((p) => p.module === module) })).filter((g) => g.perms.length > 0);

/**
 * Permission editor for one role. Loads the role's current permission keys, lets the user toggle any
 * of the 73 catalog permissions grouped by module, and saves the COMPLETE set via
 * PUT /roles/:id/permissions (atomic replace; empty set is allowed). Read-only for system roles —
 * the backend rejects edits regardless; the UI simply disables the controls.
 */
export function PermissionEditorDialog({
  roleId,
  roleName,
  readOnly = false,
  open,
  onOpenChange,
}: {
  roleId: string | null;
  roleName?: string;
  readOnly?: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): JSX.Element {
  const { data: role, isLoading } = useRole(roleId ?? undefined, open);
  const { updatePermissions } = useRoleMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load the role's current permissions into local state whenever a new role is opened.
  useEffect(() => {
    if (role) setSelected(new Set(role.permissionKeys));
  }, [role]);

  const total = PERMISSION_KEYS.length;
  const count = selected.size;

  const toggle = (key: string): void => {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setModule = (keys: string[], on: boolean): void => {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };
  const clearAll = (): void => { if (!readOnly) setSelected(new Set()); };

  const save = async (): Promise<void> => {
    if (!roleId) return;
    try {
      await updatePermissions.mutateAsync({ id: roleId, permissionKeys: [...selected] });
      toast.success('Permissions saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save permissions'));
    }
  };

  const title = roleName ?? role?.name ?? 'Role';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {readOnly ? 'Permissions' : 'Edit permissions'} · <span className="font-mono">{title}</span>
            <Badge variant="muted">{count} of {total}</Badge>
            {readOnly && <Badge variant="muted">Read-only</Badge>}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? 'System roles have a fixed permission set.' : 'Select the permissions this role grants. Saving replaces the entire set.'}
          </DialogDescription>
        </DialogHeader>

        {!readOnly && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{count} selected</span>
            <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={count === 0}>Clear all</Button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {isLoading && !role ? (
            <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-24 w-full" /></div>
          ) : (
            GROUPS.map(({ module, perms }) => {
              const keys = perms.map((p) => p.key);
              const on = keys.filter((k) => selected.has(k)).length;
              return (
                <section key={module} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{permissionModuleLabel(module)} <span className="text-xs font-normal text-muted-foreground">({on}/{keys.length})</span></h3>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" className="h-7" aria-label={`Select all ${permissionModuleLabel(module)}`} onClick={() => setModule(keys, true)}>Select all</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7" aria-label={`Clear ${permissionModuleLabel(module)}`} onClick={() => setModule(keys, false)}>Clear</Button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label key={p.key} className="flex items-start gap-2 text-sm">
                        <span className="pt-0.5"><Checkbox checked={selected.has(p.key)} onCheckedChange={() => toggle(p.key)} disabled={readOnly} aria-label={p.label} /></span>
                        <span>{p.label}{p.isDangerous && <span className="ml-1 text-xs text-amber-600">(sensitive)</span>}<br /><span className="font-mono text-[11px] text-muted-foreground">{p.key}</span></span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && <Button type="button" onClick={save} disabled={updatePermissions.isPending}>Save permissions</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
