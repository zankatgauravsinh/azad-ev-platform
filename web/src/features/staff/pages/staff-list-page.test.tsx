import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import type { ChangeEvent, MouseEventHandler, ReactNode } from 'react';
import type { Paginated, StaffDto } from '@azad/shared';
import { StaffListPage } from './staff-list-page';

interface MockMenuItemProps {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}
interface MockWrapProps {
  children?: ReactNode;
}
interface MockSelectProps {
  value?: string;
  onValueChange?: (v: string) => void;
  children?: ReactNode;
}

const h = vi.hoisted(() => ({
  useStaffListMock: vi.fn(),
  setActiveMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  formProps: { current: null as Record<string, unknown> | null },
  resetProps: { current: null as Record<string, unknown> | null },
  authUser: { current: { id: 'u-self', role: 'OWNER' } as { id: string; role: string } },
}));

vi.mock('../hooks', () => ({
  useStaffList: (q: unknown) => h.useStaffListMock(q),
  useSetStaffActive: () => ({ mutateAsync: h.setActiveMutate }),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: h.authUser.current }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

// The form dialog is covered by its own test; here we only capture the props it receives.
vi.mock('../components/staff-form-dialog', () => ({
  StaffFormDialog: (props: Record<string, unknown>) => {
    h.formProps.current = props;
    return null;
  },
}));
vi.mock('../components/reset-password-dialog', () => ({
  ResetPasswordDialog: (props: Record<string, unknown>) => {
    h.resetProps.current = props;
    return null;
  },
}));

// Render Radix primitives inline/natively so menu items and filters are driveable in jsdom.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  return {
    DropdownMenu: ({ children }: MockWrapProps) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: MockWrapProps) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: MockWrapProps) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, disabled, onClick, className }: MockMenuItemProps) =>
      React.createElement('button', { type: 'button', disabled, onClick, className }, children),
    DropdownMenuSeparator: () => null,
  };
});
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({ value, onValueChange, children }: MockSelectProps) =>
      React.createElement(
        'select',
        { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) },
        children,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: MockSelectProps) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: MockSelectProps) => React.createElement('option', { value }, children),
  };
});

const mkStaff = (over: Partial<StaffDto> = {}): StaffDto => ({
  id: 's1',
  name: 'Asha',
  email: 'asha@azadev.in',
  phone: '9876543210',
  role: 'MANAGER' as StaffDto['role'],
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const paged = (rows: StaffDto[], total = rows.length, totalPages = 1): Paginated<StaffDto> => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total, totalPages },
});

const setList = (result: Record<string, unknown>): void => {
  h.useStaffListMock.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: undefined, ...result });
};

beforeEach(() => {
  h.useStaffListMock.mockReset();
  h.setActiveMutate.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.formProps.current = null;
  h.resetProps.current = null;
  h.authUser.current = { id: 'u-self', role: 'OWNER' };
});

describe('StaffListPage', () => {
  it('renders staff with human-readable role and status', () => {
    setList({ data: paged([mkStaff(), mkStaff({ id: 's2', name: 'Ravi', role: 'TECHNICIAN', isActive: false })]) });
    render(<StaffListPage />);
    // Scope to the table — role/status labels also appear in the filter dropdowns.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Asha')).toBeInTheDocument();
    expect(table.getByText('Manager')).toBeInTheDocument();
    expect(table.getByText('Active')).toBeInTheDocument();
    expect(table.getByText('Technician')).toBeInTheDocument();
    expect(table.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows a loading state (no rows yet)', () => {
    setList({ data: undefined, isLoading: true, isFetching: true });
    render(<StaffListPage />);
    expect(screen.queryByText('Asha')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no staff', () => {
    setList({ data: paged([], 0, 1) });
    render(<StaffListPage />);
    expect(screen.getByText('No staff found')).toBeInTheDocument();
  });

  it('shows a generic error state', () => {
    setList({ error: new Error('boom') });
    render(<StaffListPage />);
    expect(screen.getByText("Couldn't load staff")).toBeInTheDocument();
  });

  it('shows an "Owner access required" state on a 403 from the backend', () => {
    const err = new AxiosError('Forbidden', 'ERR', undefined, undefined, { status: 403, data: {} } as never);
    setList({ error: err });
    render(<StaffListPage />);
    expect(screen.getByText('Owner access required')).toBeInTheDocument();
  });

  it('applies the role filter to the query', () => {
    setList({ data: paged([mkStaff()]) });
    render(<StaffListPage />);
    const roleSelect = screen.getByRole('option', { name: 'All roles' }).closest('select')!;
    fireEvent.change(roleSelect, { target: { value: 'MANAGER' } });
    expect((h.useStaffListMock.mock.calls.at(-1)![0] as { role?: string }).role).toBe('MANAGER');
  });

  it('applies the active/inactive filter to the query', () => {
    setList({ data: paged([mkStaff()]) });
    render(<StaffListPage />);
    const statusSelect = screen.getByRole('option', { name: 'Inactive' }).closest('select')!;
    fireEvent.change(statusSelect, { target: { value: 'false' } });
    expect((h.useStaffListMock.mock.calls.at(-1)![0] as { isActive?: boolean }).isActive).toBe(false);
  });

  it('paginates to the next page', () => {
    setList({ data: paged([mkStaff()], 40, 2) });
    render(<StaffListPage />);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect((h.useStaffListMock.mock.calls.at(-1)![0] as { page: number }).page).toBe(2);
  });

  it('disables deactivation for the current user', () => {
    setList({ data: paged([mkStaff({ id: 'u-self', name: 'Me', isActive: true })]) });
    render(<StaffListPage />);
    expect(screen.getByRole('button', { name: /Deactivate/ })).toBeDisabled();
  });

  it('confirms and deactivates another staff member', async () => {
    h.setActiveMutate.mockResolvedValue({});
    setList({ data: paged([mkStaff({ id: 's2', name: 'Ravi', isActive: true })]) });
    render(<StaffListPage />);
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ })); // open confirm
    expect(await screen.findByText('Deactivate Ravi?')).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Deactivate' }).at(-1)!; // dialog button
    fireEvent.click(confirm);
    await waitFor(() => expect(h.setActiveMutate).toHaveBeenCalledWith({ id: 's2', isActive: false }));
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('reports a deactivation error via a toast', async () => {
    h.setActiveMutate.mockRejectedValue(new Error('nope'));
    setList({ data: paged([mkStaff({ id: 's2', name: 'Ravi', isActive: true })]) });
    render(<StaffListPage />);
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ }));
    const confirm = (await screen.findAllByRole('button', { name: 'Deactivate' })).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it('passes disableRole to the form when editing the current user (self-demotion guard)', () => {
    setList({ data: paged([mkStaff({ id: 'u-self', name: 'Me' })]) });
    render(<StaffListPage />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(h.formProps.current?.open).toBe(true);
    expect(h.formProps.current?.disableRole).toBe(true);
  });

  it('offers Reset password for another staff member and opens the dialog for them', () => {
    setList({ data: paged([mkStaff({ id: 's2', name: 'Ravi' })]) });
    render(<StaffListPage />);
    const action = screen.getByRole('button', { name: /Reset password/ });
    fireEvent.click(action);
    expect(h.resetProps.current?.open).toBe(true);
    expect((h.resetProps.current?.staff as StaffDto).id).toBe('s2');
  });

  it('does not offer Reset password for the current user', () => {
    setList({ data: paged([mkStaff({ id: 'u-self', name: 'Me' })]) });
    render(<StaffListPage />);
    expect(screen.queryByRole('button', { name: /Reset password/ })).not.toBeInTheDocument();
  });

  it('never renders credential fields', () => {
    setList({ data: paged([mkStaff()]) });
    render(<StaffListPage />);
    expect(document.body.textContent).not.toContain('passwordHash');
    expect(document.body.textContent).not.toContain('refreshTokenHash');
  });
});
