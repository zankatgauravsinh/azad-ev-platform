import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PERMISSION_KEYS } from '@azad/shared';
import { PermissionEditorDialog } from './permission-editor-dialog';

const h = vi.hoisted(() => ({ role: { current: null as unknown }, update: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../hooks', () => ({
  useRole: () => ({ data: h.role.current, isLoading: false }),
  useRoleMutations: () => ({ updatePermissions: { mutateAsync: h.update, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const detail = (permissionKeys: string[]) => ({ id: 'r1', name: 'Front Desk', description: null, isSystem: false, isProtected: false, assignedUserCount: 0, createdAt: '', updatedAt: '', permissionKeys });

const open = (opts: { readOnly?: boolean; keys?: string[] } = {}): void => {
  cleanup();
  h.role.current = detail(opts.keys ?? ['customers.view', 'customers.create']);
  render(<PermissionEditorDialog roleId="r1" roleName="Front Desk" readOnly={opts.readOnly} open onOpenChange={() => {}} />);
};
const boxes = () => screen.getAllByRole('checkbox');
const box = (label: string) => screen.getByRole('checkbox', { name: label });
const saveBtn = () => screen.queryByRole('button', { name: 'Save permissions' });
beforeEach(() => { h.update.mockReset().mockResolvedValue({}); h.toastError.mockReset(); });

describe('PermissionEditorDialog', () => {
  it('renders all 73 catalog permissions, grouped, with current selection loaded', () => {
    open();
    expect(boxes().length).toBe(PERMISSION_KEYS.length); // 73
    expect(box('View customers')).toHaveAttribute('aria-checked', 'true');
    expect(box('View inventory')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('2 of 73')).toBeInTheDocument();
  });

  it('toggles an individual permission', () => {
    open();
    fireEvent.click(box('View inventory'));
    expect(box('View inventory')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('3 of 73')).toBeInTheDocument();
  });

  it('per-module Select all / Clear affects only that module', () => {
    open({ keys: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Select all Customers' }));
    expect(box('View customers')).toHaveAttribute('aria-checked', 'true');
    expect(box('Delete customers')).toHaveAttribute('aria-checked', 'true');
    expect(box('View inventory')).toHaveAttribute('aria-checked', 'false'); // untouched
    fireEvent.click(screen.getByRole('button', { name: 'Clear Customers' }));
    expect(box('View customers')).toHaveAttribute('aria-checked', 'false');
  });

  it('Clear all empties the set and saves [] (zero permissions allowed)', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('0 of 73')).toBeInTheDocument();
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'r1', permissionKeys: [] }));
  });

  it('saves the complete selected set', async () => {
    open({ keys: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Select all Customers' }));
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const arg = h.update.mock.calls[0]![0] as { id: string; permissionKeys: string[] };
    expect(arg.id).toBe('r1');
    expect(arg.permissionKeys).toContain('customers.view');
    expect(arg.permissionKeys).toContain('customers.delete');
    expect(arg.permissionKeys.every((k) => k.startsWith('customers.'))).toBe(true);
  });

  it('read-only (system role): no Save, no per-module controls, checkboxes disabled', () => {
    open({ readOnly: true });
    expect(saveBtn()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select all Customers' })).toBeNull();
    expect(box('View customers')).toBeDisabled();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('surfaces save errors', async () => {
    open();
    h.update.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});
