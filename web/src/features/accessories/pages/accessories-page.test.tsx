import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AccessoryDto } from '@azad/shared';
import { AccessoriesPage } from './accessories-page';

const h = vi.hoisted(() => ({ perms: new Set<string>(), lists: [] as unknown[], setActive: vi.fn(), toastError: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.has(p) }));
vi.mock('../hooks', () => ({
  useAccessoryList: (f: unknown) => {
    h.lists.push(f);
    return { data: rows, isLoading: false, isFetching: false };
  },
  useAccessoryCategories: () => ({ data: ['Safety'] }),
  useAccessoryMutations: () => ({ setActive: { mutateAsync: h.setActive, isPending: false } }),
}));
vi.mock('../components/accessory-stock-dialog', () => ({ AccessoryStockDialog: ({ id }: { id: string | null }) => (id ? <p>stock of {id}</p> : null) }));
vi.mock('../components/accessory-form-dialog', () => ({ AccessoryFormDialog: ({ open, accessory }: { open: boolean; accessory?: AccessoryDto }) => (open ? <p>{accessory ? `editing ${accessory.name}` : 'adding'}</p> : null) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const base = { sku: null, category: 'Safety', reserved: 0, minStock: 2, isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '' };
const rows: AccessoryDto[] = [
  { ...base, id: 'a1', name: 'Helmet', sku: 'HEL-01', sellPrice: '150000', avgCost: '90000', onHand: 10, reserved: 3, available: 7, lowStock: false },
  { ...base, id: 'a2', name: 'Guard', sellPrice: '50000', avgCost: '20000', onHand: 2, available: 2, lowStock: true },
  { ...base, id: 'a3', name: 'Mat', sellPrice: '30000', avgCost: '0', onHand: 0, available: 0, lowStock: true, isActive: false },
];

const renderWith = (perms: string[]): void => {
  h.perms = new Set(perms);
  render(<MemoryRouter><AccessoriesPage /></MemoryRouter>);
};
const row = (name: string): HTMLElement => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  h.lists = [];
  h.setActive.mockReset().mockResolvedValue({});
  h.toastError.mockReset();
});
afterEach(cleanup);

describe('AccessoriesPage', () => {
  it('lists the catalogue with stock and badges; view-only users get no controls and no cost', () => {
    renderWith(['accessories.view']);
    expect(within(row('Helmet')).getByText('HEL-01')).toBeInTheDocument();
    expect(within(row('Guard')).getByText('Low')).toBeInTheDocument();
    expect(within(row('Mat')).getByText('Out of stock')).toBeInTheDocument();
    expect(within(row('Mat')).getByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add accessory/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Helmet' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Avg cost' })).toBeNull();
    expect(screen.queryByText('Stock value (at cost)')).toBeNull();
    expect(screen.getByText('12')).toBeInTheDocument(); // pieces in stock: 10 + 2 + 0
    expect(screen.getByText('3 reserved for bookings')).toBeInTheDocument();
  });

  it('clicking a row (or its stock button) opens the stock and history', () => {
    renderWith(['accessories.view']);
    fireEvent.click(screen.getByText('Guard'));
    expect(screen.getByText('stock of a2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stock of Helmet' }));
    expect(screen.getByText('stock of a1')).toBeInTheDocument();
  });

  it('the owner sees the average cost and the stock value', () => {
    renderWith(['accessories.view', 'inventory.cost']);
    expect(screen.getByRole('columnheader', { name: 'Avg cost' })).toBeInTheDocument();
    // 10 × ₹900 + 2 × ₹200 = ₹9,400
    expect(screen.getByText('Stock value (at cost)').parentElement).toHaveTextContent('9,400');
  });

  it('managers add, edit, deactivate and activate', async () => {
    renderWith(['accessories.view', 'accessories.manage']);
    fireEvent.click(screen.getAllByRole('button', { name: /Add accessory/ })[0]!);
    expect(screen.getByText('adding')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Guard' }));
    expect(screen.getByText('editing Guard')).toBeInTheDocument();
    expect(screen.queryByText('stock of a2')).toBeNull(); // the button does not also open the row
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Helmet' }));
    await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ id: 'a1', active: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate Mat' }));
    await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ id: 'a3', active: true }));
  });

  it('shows the reason when deactivation is refused', async () => {
    h.setActive.mockRejectedValue(new Error('3 of Helmet are reserved for bookings'));
    renderWith(['accessories.view', 'accessories.manage']);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Helmet' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it('filters by status, category and low stock', () => {
    renderWith(['accessories.view']);
    const [category, status] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(status!, { target: { value: 'all' } });
    fireEvent.change(category!, { target: { value: 'Safety' } });
    fireEvent.click(screen.getByRole('button', { name: /Low \/ out of stock/ }));
    expect(h.lists).toContainEqual({ q: undefined, category: 'Safety', status: 'all', lowStock: true });
  });
});
