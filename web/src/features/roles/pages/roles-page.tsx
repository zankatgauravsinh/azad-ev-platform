import { useState } from 'react';
import { ArrowLeft, Copy, KeyRound, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { RoleListItem } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useRoles, useRoleMutations } from '../hooks';
import { RoleFormDialog, type RoleFormMode } from '../components/role-form-dialog';
import { PermissionEditorDialog } from '../components/permission-editor-dialog';

export function RolesPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('roles.manage');

  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ mode: RoleFormMode; role?: RoleListItem } | null>(null);
  const [editor, setEditor] = useState<{ id: string; name?: string; readOnly: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleListItem | undefined>();

  const { data, isLoading, isFetching } = useRoles({ page, pageSize: 50 });
  const { remove } = useRoleMutations();

  if (!canManage) {
    return <EmptyState icon={ShieldCheck} title="Roles & permissions" description="You don’t have permission to manage roles." />;
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success(`Deleted ${deleteTarget.name}`);
    } catch (e) {
      // Backend stays authoritative (e.g. 409 when the role was just assigned).
      toast.error(apiErrorMessage(e, 'Could not delete the role'));
    }
  };

  const columns: Column<RoleListItem>[] = [
    {
      key: 'name', header: 'Role',
      render: (r) => <div><p className="font-medium">{r.name}</p>{r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}</div>,
    },
    { key: 'type', header: 'Type', render: (r) => <span className="flex items-center gap-1"><Badge variant={r.isSystem ? 'accent' : 'muted'}>{r.isSystem ? 'System' : 'Custom'}</Badge>{r.isProtected && <Badge variant="warning">Protected</Badge>}</span> },
    { key: 'permissionCount', header: 'Permissions', align: 'right', render: (r) => <span className="tabular-nums">{r.permissionCount}</span> },
    { key: 'assignedUserCount', header: 'Users', align: 'right', render: (r) => <span className="tabular-nums">{r.assignedUserCount}</span> },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const canDuplicate = !r.isProtected; // backend blocks duplicating the OWNER (protected) role
        const canDelete = !r.isSystem && r.assignedUserCount === 0;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {r.isSystem ? (
                <DropdownMenuItem onClick={() => setEditor({ id: r.id, name: r.name, readOnly: true })}><KeyRound className="h-4 w-4" /> View permissions</DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => setForm({ mode: 'edit', role: r })}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditor({ id: r.id, name: r.name, readOnly: false })}><KeyRound className="h-4 w-4" /> Edit permissions</DropdownMenuItem>
                </>
              )}
              {canDuplicate && <DropdownMenuItem onClick={() => setForm({ mode: 'duplicate', role: r })}><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>}
              {canDelete && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div>
      <button type="button" onClick={() => navigate('/settings')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to settings</button>
      <PageHeader title="Roles & permissions" description="System roles are fixed; create custom roles and choose exactly what they can do." actions={<Button onClick={() => setForm({ mode: 'create' })}><Plus className="h-4 w-4" /> New role</Button>} />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(r) => r.id}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(r) => setEditor({ id: r.id, name: r.name, readOnly: r.isSystem })}
        emptyState={<EmptyState icon={ShieldCheck} title="No roles" description="Create a custom role to get started." />}
      />

      <RoleFormDialog
        mode={form?.mode ?? 'create'}
        open={form !== null}
        onOpenChange={(o) => { if (!o) setForm(null); }}
        role={form?.role}
        onSaved={form?.mode === 'create' ? (id) => setEditor({ id, readOnly: false }) : undefined}
      />
      <PermissionEditorDialog
        roleId={editor?.id ?? null}
        roleName={editor?.name}
        readOnly={editor?.readOnly ?? false}
        open={editor !== null}
        onOpenChange={(o) => { if (!o) setEditor(null); }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(undefined)}
        title={`Delete ${deleteTarget?.name}?`}
        description="This permanently removes the custom role. It must have no assigned users."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
