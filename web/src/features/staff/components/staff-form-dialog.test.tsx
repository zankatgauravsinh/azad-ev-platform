import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import type { ChangeEvent, ReactNode } from 'react';
import type { Paginated, RoleListItem, StaffDto } from '@azad/shared';
import { StaffFormDialog } from './staff-form-dialog';

interface MockSelectProps {
  value?: string;
  disabled?: boolean;
  onValueChange?: (v: string) => void;
  children?: ReactNode;
}

// Valid v4 UUIDs so the roleId zod check (`.uuid()`) passes; ids double as the <option> values.
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const TECH_ID = '33333333-3333-4333-8333-333333333333';
const CUSTOM_ID = '44444444-4444-4444-8444-444444444444';

const role = (id: string, name: string, isSystem: boolean): RoleListItem => ({
  id, name, description: null, isSystem, isProtected: id === OWNER_ID,
  assignedUserCount: 0, permissionCount: 1, createdAt: '', updatedAt: '',
});
const rolesPage: Paginated<RoleListItem> = {
  data: [role(OWNER_ID, 'Owner', true), role(MANAGER_ID, 'Manager', true), role(TECH_ID, 'Technician', true), role(CUSTOM_ID, 'Front Desk', false)],
  meta: { page: 1, pageSize: 100, total: 4, totalPages: 1 },
};

const h = vi.hoisted(() => ({ useRoles: vi.fn(), can: vi.fn() }));

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock('../hooks', () => ({
  useCreateStaff: () => ({ mutateAsync: createMutate }),
  useUpdateStaff: () => ({ mutateAsync: updateMutate }),
}));
vi.mock('@/features/roles/hooks', () => ({ useRoles: (q: unknown, enabled?: boolean) => h.useRoles(q, enabled) }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: h.can }) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

// Replace the Radix Select with a native <select> so role changes are driveable in jsdom.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({ value, onValueChange, disabled, children }: MockSelectProps) =>
      React.createElement(
        'select',
        {
          'aria-label': 'Role',
          value,
          disabled,
          onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value),
        },
        children,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: MockSelectProps) => React.createElement(React.Fragment, null, children),
    // Real Radix SelectItem renders a div; the mock maps to <option> (value is all the tests need),
    // dropping the rich label children so jsdom doesn't warn about <span> inside <option>.
    SelectItem: ({ value }: MockSelectProps) => React.createElement('option', { value }, value),
  };
});

const input = (name: string): HTMLInputElement =>
  document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fill = (name: string, value: string): void => {
  fireEvent.change(input(name), { target: { value } });
};
const pickRole = (id: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: id } });
};

const staff: StaffDto = {
  id: 's1',
  name: 'Asha',
  email: 'asha@azadev.in',
  phone: '9876543210',
  role: 'MANAGER' as StaffDto['role'],
  roleId: MANAGER_ID,
  roleName: 'Manager',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  h.useRoles.mockReset().mockReturnValue({ data: rolesPage, isLoading: false });
  h.can.mockReset().mockReturnValue(true);
  localStorage.clear();
  sessionStorage.clear();
});

describe('StaffFormDialog — create', () => {
  it('blocks submission and shows validation errors when fields are empty/invalid', async () => {
    render(<StaffFormDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Select a role')).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('creates a staff member with the selected roleId and the legacy role fallback', async () => {
    const onOpenChange = vi.fn();
    createMutate.mockResolvedValue({ id: 'new' });
    render(<StaffFormDialog open onOpenChange={onOpenChange} />);
    fill('name', 'Ravi');
    fill('email', 'ravi@azadev.in');
    fill('phone', '9811111111');
    fill('password', 'Secret123');
    pickRole(TECH_ID); // a system role
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).toEqual({
      name: 'Ravi',
      email: 'ravi@azadev.in',
      phone: '9811111111',
      role: 'SALES_EXECUTIVE', // legacy fallback; backend overrides from the system role's key
      roleId: TECH_ID,
      password: 'Secret123',
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates with a custom roleId (role stays the fallback enum)', async () => {
    createMutate.mockResolvedValue({ id: 'new' });
    render(<StaffFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Ravi');
    fill('email', 'ravi@azadev.in');
    fill('password', 'Secret123');
    pickRole(CUSTOM_ID); // a custom role
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ role: 'SALES_EXECUTIVE', roleId: CUSTOM_ID });
  });

  it('only fetches the role catalog when open AND the actor can manage staff', () => {
    h.can.mockReturnValue(false);
    render(<StaffFormDialog open onOpenChange={() => {}} />);
    expect(h.useRoles).toHaveBeenLastCalledWith({ page: 1, pageSize: 100 }, false);
  });

  it('surfaces a duplicate-email conflict via a toast and keeps the dialog open', async () => {
    const onOpenChange = vi.fn();
    createMutate.mockRejectedValue(
      new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 409,
        data: { message: 'Email already registered' },
      } as never),
    );
    render(<StaffFormDialog open onOpenChange={onOpenChange} />);
    fill('name', 'Ravi');
    fill('email', 'dup@azadev.in');
    fill('password', 'Secret123');
    pickRole(MANAGER_ID);
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Email already registered'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables the submit button while the mutation is in flight (no double submit)', async () => {
    createMutate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<StaffFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Ravi');
    fill('email', 'ravi@azadev.in');
    fill('password', 'Secret123');
    pickRole(MANAGER_ID);
    const submit = screen.getByRole('button', { name: 'Create staff' });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('never persists the temporary password to client storage', async () => {
    createMutate.mockResolvedValue({ id: 'new' });
    render(<StaffFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Ravi');
    fill('email', 'ravi@azadev.in');
    fill('password', 'Secret123');
    pickRole(MANAGER_ID);
    // The input opts out of autofill/save.
    expect(input('password').getAttribute('autocomplete')).toBe('new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(JSON.stringify(localStorage)).not.toContain('Secret123');
    expect(JSON.stringify(sessionStorage)).not.toContain('Secret123');
  });
});

describe('StaffFormDialog — edit', () => {
  it('prefills the assigned role and submits roleId (+ fallback enum), never email or password', async () => {
    const onOpenChange = vi.fn();
    updateMutate.mockResolvedValue({ id: 's1' });
    render(<StaffFormDialog open onOpenChange={onOpenChange} staff={staff} />);
    // Email is read-only in edit mode.
    expect(document.querySelector('input[name="email"]')).toBeNull();
    // Role is prefilled from staff.roleId.
    expect((screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement).value).toBe(MANAGER_ID);
    fill('name', 'Asha R');
    fill('phone', '9822222222');
    pickRole(CUSTOM_ID);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]![0]).toEqual({ name: 'Asha R', phone: '9822222222', role: 'SALES_EXECUTIVE', roleId: CUSTOM_ID });
    expect(toastSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables the role field when editing the current user (self-demotion guard)', () => {
    render(<StaffFormDialog open onOpenChange={() => {}} staff={staff} disableRole />);
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
    expect(screen.getByText("You can't change your own role.")).toBeInTheDocument();
  });

  it('surfaces an API error on edit via a toast', async () => {
    updateMutate.mockRejectedValue(new Error('nope'));
    render(<StaffFormDialog open onOpenChange={() => {}} staff={staff} />);
    fill('name', 'Asha Q');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
