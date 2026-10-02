import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import type { ChangeEvent, ReactNode } from 'react';
import type { StaffDto } from '@azad/shared';
import { StaffFormDialog } from './staff-form-dialog';

interface MockSelectProps {
  value?: string;
  disabled?: boolean;
  onValueChange?: (v: string) => void;
  children?: ReactNode;
}

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock('../hooks', () => ({
  useCreateStaff: () => ({ mutateAsync: createMutate }),
  useUpdateStaff: () => ({ mutateAsync: updateMutate }),
}));

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
    SelectItem: ({ value, children }: MockSelectProps) => React.createElement('option', { value }, children),
  };
});

const input = (name: string): HTMLInputElement =>
  document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fill = (name: string, value: string): void => {
  fireEvent.change(input(name), { target: { value } });
};

const staff: StaffDto = {
  id: 's1',
  name: 'Asha',
  email: 'asha@azadev.in',
  phone: '9876543210',
  role: 'MANAGER' as StaffDto['role'],
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
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
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('creates a staff member and reports success', async () => {
    const onOpenChange = vi.fn();
    createMutate.mockResolvedValue({ id: 'new' });
    render(<StaffFormDialog open onOpenChange={onOpenChange} />);
    fill('name', 'Ravi');
    fill('email', 'ravi@azadev.in');
    fill('phone', '9811111111');
    fill('password', 'Secret123');
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'TECHNICIAN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).toEqual({
      name: 'Ravi',
      email: 'ravi@azadev.in',
      phone: '9811111111',
      role: 'TECHNICIAN',
      password: 'Secret123',
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
    // The input opts out of autofill/save.
    expect(input('password').getAttribute('autocomplete')).toBe('new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(JSON.stringify(localStorage)).not.toContain('Secret123');
    expect(JSON.stringify(sessionStorage)).not.toContain('Secret123');
  });
});

describe('StaffFormDialog — edit', () => {
  it('updates name/phone/role and never sends email or password', async () => {
    const onOpenChange = vi.fn();
    updateMutate.mockResolvedValue({ id: 's1' });
    render(<StaffFormDialog open onOpenChange={onOpenChange} staff={staff} />);
    // Email is read-only in edit mode.
    expect(document.querySelector('input[name="email"]')).toBeNull();
    fill('name', 'Asha R');
    fill('phone', '9822222222');
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'ACCOUNTANT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]![0]).toEqual({ name: 'Asha R', phone: '9822222222', role: 'ACCOUNTANT' });
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
