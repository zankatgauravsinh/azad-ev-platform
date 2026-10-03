import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { InventoryUnitDto } from '@azad/shared';
import { InventoryListPage } from './inventory-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }),
  useCan: (p: string) => h.perms.current.has(p),
}));

const unit = {
  id: 'u1', vin: 'VIN1', status: 'AVAILABLE', sellingPrice: 1000n, supplier: 'ACME', purchaseDate: null,
  variant: { name: 'Pro', colour: 'Red', hexColour: '#f00', model: { name: 'VX', brand: 'Azad' } },
} as unknown as InventoryUnitDto;

vi.mock('../hooks', () => ({
  useInventoryList: () => ({ data: { data: [unit], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isLoading: false, isFetching: false }),
  // Mirror the real hook: data only when enabled (inventory.dashboard).
  useInventoryDashboard: (enabled: boolean) => ({ data: enabled ? { stats: { total: 1, available: 1, reserved: 0, booked: 0, delivered: 0, inService: 0 } } : undefined }),
  useModels: () => ({ data: [] }),
  useDeleteUnit: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../components/inventory-widgets', () => ({ InventoryWidgets: () => <div data-testid="inv-widgets" /> }));
vi.mock('../components/unit-form-dialog', () => ({ UnitFormDialog: () => null }));
vi.mock('../components/change-status-dialog', () => ({ ChangeStatusDialog: () => null }));
vi.mock('../components/import-dialog', () => ({ ImportDialog: () => null }));
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
  render(<MemoryRouter><InventoryListPage /></MemoryRouter>);
};
const q = {
  add: () => screen.queryByRole('button', { name: /Add scooter/ }),
  import: () => screen.queryByRole('button', { name: 'Import' }),
  export: () => screen.queryByRole('button', { name: 'Export' }),
  status: () => screen.queryByRole('button', { name: /Change status/ }),
  edit: () => screen.queryByRole('button', { name: 'Edit' }),
  del: () => screen.queryByRole('button', { name: 'Delete' }),
  widgets: () => screen.queryByTestId('inv-widgets'),
};

beforeEach(() => { h.perms.current = new Set(); });

describe('InventoryListPage permission gating (distinct permissions, not one canWrite)', () => {
  it('view-only: no create/export/status/edit/delete/dashboard controls', () => {
    renderWith(['inventory.view']);
    expect(q.add()).toBeNull();
    expect(q.import()).toBeNull();
    expect(q.export()).toBeNull();
    expect(q.status()).toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.del()).toBeNull();
    expect(q.widgets()).toBeNull();
  });

  it('inventory.create → Add scooter + Import (nothing else)', () => {
    renderWith(['inventory.view', 'inventory.create']);
    expect(q.add()).not.toBeNull();
    expect(q.import()).not.toBeNull();
    expect(q.export()).toBeNull();
    expect(q.status()).toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.del()).toBeNull();
  });

  it('inventory.export → Export only (custom role inventory.view+export)', () => {
    renderWith(['inventory.view', 'inventory.export']);
    expect(q.export()).not.toBeNull();
    expect(q.add()).toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.status()).toBeNull();
    expect(q.widgets()).toBeNull();
  });

  it('inventory.status → Change status only; inventory.update → Edit only; inventory.delete → Delete only', () => {
    renderWith(['inventory.view', 'inventory.status']);
    expect(q.status()).not.toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.del()).toBeNull();

    renderWith(['inventory.view', 'inventory.update']);
    expect(q.edit()).not.toBeNull();
    expect(q.status()).toBeNull();
    expect(q.del()).toBeNull();

    renderWith(['inventory.view', 'inventory.delete']);
    expect(q.del()).not.toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.status()).toBeNull();
  });

  it('inventory.dashboard → widgets shown; absent otherwise', () => {
    renderWith(['inventory.view']);
    expect(q.widgets()).toBeNull();
    renderWith(['inventory.view', 'inventory.dashboard']);
    expect(q.widgets()).not.toBeNull();
  });
});
