import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RoleListItem } from '@azad/shared';
import { RoleFormDialog, type RoleFormMode } from './role-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), duplicate: vi.fn(), saved: vi.fn() }));
vi.mock('../hooks', () => ({
  useRoleMutations: () => ({
    create: { mutateAsync: h.create },
    update: { mutateAsync: h.update },
    duplicate: { mutateAsync: h.duplicate },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const custom: RoleListItem = { id: 'r1', name: 'Manager', description: 'Mgr', isSystem: false, isProtected: false, assignedUserCount: 0, permissionCount: 5, createdAt: '', updatedAt: '' };

const open = (mode: RoleFormMode, role?: RoleListItem): void => {
  cleanup();
  render(<RoleFormDialog mode={mode} open role={role} onOpenChange={() => {}} onSaved={h.saved} />);
};
const name = () => screen.getByLabelText('Name') as HTMLInputElement;
const submit = (label: RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ id: 'new1', name: 'Clerk' });
  h.update.mockReset().mockResolvedValue({ id: 'r1', name: 'New' });
  h.duplicate.mockReset().mockResolvedValue({ id: 'dup1', name: 'Manager (copy)' });
  h.saved.mockReset();
});

describe('RoleFormDialog', () => {
  it('create: sends empty permission set and fires onSaved with the new id', async () => {
    open('create');
    fireEvent.change(name(), { target: { value: 'Clerk' } });
    submit(/Create role/);
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ name: 'Clerk', description: null, permissionKeys: [] }));
    await waitFor(() => expect(h.saved).toHaveBeenCalledWith('new1'));
  });

  it('edit: prefills the role and sends name + description', async () => {
    open('edit', custom);
    expect(name().value).toBe('Manager');
    fireEvent.change(name(), { target: { value: 'Manager 2' } });
    submit(/Save changes/);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'r1', input: { name: 'Manager 2', description: 'Mgr' } }));
  });

  it('duplicate: defaults the name to “(copy)” and calls duplicate', async () => {
    open('duplicate', custom);
    expect(name().value).toBe('Manager (copy)');
    submit(/Create copy/);
    await waitFor(() => expect(h.duplicate).toHaveBeenCalledWith({ id: 'r1', input: { name: 'Manager (copy)', description: 'Mgr' } }));
    await waitFor(() => expect(h.saved).toHaveBeenCalledWith('dup1'));
  });

  it('validates the name (too short) and does not submit', async () => {
    open('create');
    fireEvent.change(name(), { target: { value: 'A' } });
    submit(/Create role/);
    expect(await screen.findByText(/at least 2 characters/)).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });
});
