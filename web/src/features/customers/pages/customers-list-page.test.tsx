import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { CustomerListItem } from '@azad/shared';
import { CustomersListPage } from './customers-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));

vi.mock('@/features/auth/auth-context', () => ({
  useCan: (p: string) => h.perms.current.has(p),
  useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }),
}));

const row: CustomerListItem = {
  id: 'c1', name: 'Asha', phone: '9876543210', city: 'Pune', leadStatus: 'NEW',
  assignedTo: null, counts: { followUpsPending: 0 }, updatedAt: new Date().toISOString(),
} as unknown as CustomerListItem;

vi.mock('../hooks', () => ({
  useCustomerList: () => ({ data: { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isLoading: false, isFetching: false }),
  useCustomerStats: () => ({ data: { total: 1, byStatus: {} } }),
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../components/customer-form-dialog', () => ({ CustomerFormDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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

const renderWith = (perms: string[]): void => {
  cleanup(); // isolate repeated renders within a single test
  h.perms.current = new Set(perms);
  render(<MemoryRouter><CustomersListPage /></MemoryRouter>);
};
const addBtn = () => screen.queryByRole('button', { name: /Add customer/ });
const editItem = () => screen.queryByRole('button', { name: 'Edit' });
const deleteItem = () => screen.queryByRole('button', { name: 'Delete' });

beforeEach(() => { h.perms.current = new Set(); });

describe('CustomersListPage permission gating', () => {
  it('create → Add customer visible only with customers.create', () => {
    renderWith(['customers.view']);
    expect(addBtn()).toBeNull();
    renderWith(['customers.view', 'customers.create']);
    expect(addBtn()).not.toBeNull();
  });

  it('update → Edit action visible only with customers.update', () => {
    renderWith(['customers.view']);
    expect(editItem()).toBeNull();
    renderWith(['customers.view', 'customers.update']);
    expect(editItem()).not.toBeNull();
  });

  it('delete → Delete action visible only with customers.delete', () => {
    renderWith(['customers.view']);
    expect(deleteItem()).toBeNull();
    renderWith(['customers.view', 'customers.delete']);
    expect(deleteItem()).not.toBeNull();
  });

  it('view-only custom role sees no create/update/delete controls', () => {
    renderWith(['customers.view']);
    expect(addBtn()).toBeNull();
    expect(editItem()).toBeNull();
    expect(deleteItem()).toBeNull();
  });

  it('full-access role sees all three', () => {
    renderWith(['customers.view', 'customers.create', 'customers.update', 'customers.delete']);
    expect(addBtn()).not.toBeNull();
    expect(editItem()).not.toBeNull();
    expect(deleteItem()).not.toBeNull();
  });
});
