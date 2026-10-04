import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { RoleListItem } from '@azad/shared';
import { RolesPage } from './roles-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, remove: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const roles: RoleListItem[] = [
  { id: 'owner', name: 'Owner', description: null, isSystem: true, isProtected: true, assignedUserCount: 1, permissionCount: 73, createdAt: '', updatedAt: '' },
  { id: 'manager', name: 'Manager', description: null, isSystem: true, isProtected: false, assignedUserCount: 0, permissionCount: 70, createdAt: '', updatedAt: '' },
  { id: 'cust-free', name: 'Front Desk', description: 'Custom', isSystem: false, isProtected: false, assignedUserCount: 0, permissionCount: 5, createdAt: '', updatedAt: '' },
  { id: 'cust-used', name: 'Cashier', description: null, isSystem: false, isProtected: false, assignedUserCount: 2, permissionCount: 10, createdAt: '', updatedAt: '' },
];
vi.mock('../hooks', () => ({
  useRoles: () => ({ data: { data: roles, meta: { page: 1, pageSize: 50, total: roles.length, totalPages: 1 } }, isLoading: false, isFetching: false }),
  useRoleMutations: () => ({ remove: { mutateAsync: h.remove } }),
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
vi.mock('../components/role-form-dialog', () => ({
  RoleFormDialog: (p: { open: boolean; mode: string; role?: RoleListItem; onSaved?: (id: string) => void }) =>
    p.open ? <div data-testid="role-form" data-mode={p.mode} data-role={p.role?.id ?? ''}><button onClick={() => p.onSaved?.('new-id')}>fire-saved</button></div> : null,
}));
vi.mock('../components/permission-editor-dialog', () => ({
  PermissionEditorDialog: (p: { open: boolean; roleId: string | null; readOnly: boolean }) =>
    p.open ? <div data-testid="perm-editor" data-role={p.roleId ?? ''} data-readonly={String(p.readOnly)} /> : null,
}));
// Render Radix dropdown primitives inline so menu items are directly queryable.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  type P = { children?: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; className?: string };
  return {
    DropdownMenu: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, onClick, className }: P) => React.createElement('button', { type: 'button', onClick, className }, children),
    DropdownMenuSeparator: () => null,
  };
});

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><RolesPage /></MemoryRouter>); };
const item = (name: RegExp) => screen.queryAllByRole('button', { name });
beforeEach(() => { h.perms.current = new Set(); h.remove.mockReset().mockResolvedValue(undefined); h.toastError.mockReset(); h.toastSuccess.mockReset(); });

describe('RolesPage', () => {
  it('blocks users without roles.manage', () => {
    renderWith([]);
    expect(screen.getByText(/don’t have permission to manage roles/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New role/ })).toBeNull();
  });

  it('lists roles with type/protected indicators and New role action', () => {
    renderWith(['roles.manage']);
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Front Desk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New role/ })).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBe(2);
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('system roles: View permissions only; Duplicate hidden for OWNER (protected)', () => {
    renderWith(['roles.manage']);
    expect(item(/View permissions/).length).toBe(2);      // owner + manager (system)
    // Duplicate appears for every non-protected role (manager + 2 customs) = 3; OWNER excluded
    expect(item(/Duplicate/).length).toBe(3);
  });

  it('custom role actions: Edit, Edit permissions, Duplicate; Delete only when no assigned users', () => {
    renderWith(['roles.manage']);
    expect(item(/^Edit$/).length).toBe(2);                // both custom roles (not system)
    expect(item(/Edit permissions/).length).toBe(2);      // both custom roles
    expect(item(/Delete/).length).toBe(1);                // only Front Desk (0 users); Cashier (2 users) excluded
  });

  it('New role opens the create form; firing save opens the permission editor for the new role', () => {
    renderWith(['roles.manage']);
    fireEvent.click(screen.getByRole('button', { name: /New role/ }));
    const form = screen.getByTestId('role-form');
    expect(form).toHaveAttribute('data-mode', 'create');
    fireEvent.click(screen.getByText('fire-saved'));
    const editor = screen.getByTestId('perm-editor');
    expect(editor).toHaveAttribute('data-role', 'new-id');
    expect(editor).toHaveAttribute('data-readonly', 'false');
  });

  it('View permissions opens the editor read-only for a system role', () => {
    renderWith(['roles.manage']);
    fireEvent.click(item(/View permissions/)[0]!);
    expect(screen.getByTestId('perm-editor')).toHaveAttribute('data-readonly', 'true');
  });

  it('Delete confirms, calls the API, and surfaces backend errors', async () => {
    h.remove.mockRejectedValueOnce(new Error('assigned'));
    renderWith(['roles.manage']);
    fireEvent.click(item(/Delete/)[0]!);                   // opens ConfirmDialog
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('cust-free'));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});
