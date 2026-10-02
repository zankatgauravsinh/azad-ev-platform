import { useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { KeyRound, MoreHorizontal, Pencil, Plus, ShieldAlert, UserCheck, UserCog, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { ROLES, Role, type StaffDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { roleLabel } from '@/lib/labels';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSetStaffActive, useStaffList } from '../hooks';
import { StaffFormDialog } from '../components/staff-form-dialog';
import { ResetPasswordDialog } from '../components/reset-password-dialog';
import type { StaffQuery } from '../api';

type ActiveFilter = 'ALL' | 'true' | 'false';

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '—');

export function StaffListPage(): JSX.Element {
  const { user } = useAuth();
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [active, setActive] = useState<ActiveFilter>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<StaffDto | undefined>();
  const [deactivateTarget, setDeactivateTarget] = useState<StaffDto | undefined>();
  const [resetTarget, setResetTarget] = useState<StaffDto | undefined>();

  const query: StaffQuery = useMemo(
    () => ({
      page,
      pageSize: 20,
      role: roleFilter === 'ALL' ? undefined : roleFilter,
      isActive: active === 'ALL' ? undefined : active === 'true',
    }),
    [page, roleFilter, active],
  );
  const { data, isLoading, isFetching, error } = useStaffList(query);
  const setActiveMut = useSetStaffActive();

  const openCreate = (): void => {
    setEditStaff(undefined);
    setFormOpen(true);
  };
  const openEdit = (s: StaffDto): void => {
    setEditStaff(s);
    setFormOpen(true);
  };

  const confirmDeactivate = async (): Promise<void> => {
    if (!deactivateTarget) return;
    try {
      await setActiveMut.mutateAsync({ id: deactivateTarget.id, isActive: false });
      toast.success(`${deactivateTarget.name} deactivated`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not deactivate'));
    }
  };

  // Activation is non-destructive — apply directly without a confirmation step.
  const activate = async (s: StaffDto): Promise<void> => {
    try {
      await setActiveMut.mutateAsync({ id: s.id, isActive: true });
      toast.success(`${s.name} reactivated`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not reactivate'));
    }
  };

  // The backend is authoritative for authorization; a 403 here means a non-OWNER reached the page.
  if (isAxiosError(error) && error.response?.status === 403) {
    return (
      <div>
        <PageHeader title="Staff" description="Manage staff accounts and roles." />
        <EmptyState icon={ShieldAlert} title="Owner access required" description="Only an owner can manage staff accounts." />
      </div>
    );
  }

  const columns: Column<StaffDto>[] = [
    { key: 'name', header: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'email', header: 'Email', render: (s) => <span className="text-sm">{s.email}</span> },
    { key: 'phone', header: 'Phone', render: (s) => (s.phone ? <span className="font-mono text-xs">{s.phone}</span> : '—') },
    { key: 'role', header: 'Role', render: (s) => roleLabel(s.role) },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <Badge variant={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    { key: 'lastLoginAt', header: 'Last Login', render: (s) => fmtDate(s.lastLoginAt) },
    { key: 'createdAt', header: 'Created', render: (s) => fmtDate(s.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => {
        const isSelf = s.id === user?.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => openEdit(s)}>
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
              {/* Admin password reset — not offered for the current owner (they use Change Password). */}
              {!isSelf && (
                <DropdownMenuItem onClick={() => setResetTarget(s)}>
                  <KeyRound className="h-4 w-4" /> Reset password
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {s.isActive ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  // Owner cannot deactivate themselves (backend also blocks this).
                  disabled={isSelf}
                  onClick={() => setDeactivateTarget(s)}
                >
                  <UserX className="h-4 w-4" /> Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void activate(s)}>
                  <UserCheck className="h-4 w-4" /> Activate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Manage staff accounts and roles."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add staff
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select
          value={roleFilter}
          onValueChange={(v) => {
            setRoleFilter(v as Role | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={active}
          onValueChange={(v) => {
            setActive(v as ActiveFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <EmptyState
          icon={ShieldAlert}
          title="Couldn't load staff"
          description={apiErrorMessage(error, 'Please try again.')}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          getRowId={(s) => s.id}
          page={data?.meta}
          onPageChange={setPage}
          loading={isLoading || isFetching}
          emptyState={
            <EmptyState
              icon={UserCog}
              title="No staff found"
              description={roleFilter !== 'ALL' || active !== 'ALL' ? 'Try clearing filters.' : 'Add your first staff member.'}
              action={
                roleFilter === 'ALL' && active === 'ALL' ? (
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Add staff
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <StaffFormDialog
        key={editStaff?.id ?? 'new'}
        open={formOpen}
        onOpenChange={setFormOpen}
        staff={editStaff}
        disableRole={Boolean(editStaff) && editStaff?.id === user?.id}
      />
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(o) => !o && setDeactivateTarget(undefined)}
        title={`Deactivate ${deactivateTarget?.name}?`}
        description="They will immediately lose access and be signed out of all sessions. You can reactivate them later."
        confirmLabel="Deactivate"
        destructive
        onConfirm={confirmDeactivate}
      />
      <ResetPasswordDialog
        key={resetTarget?.id ?? 'reset'}
        open={Boolean(resetTarget)}
        onOpenChange={(o) => !o && setResetTarget(undefined)}
        staff={resetTarget}
      />
    </div>
  );
}
