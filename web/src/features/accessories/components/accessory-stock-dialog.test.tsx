import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AccessoryDetailDto } from '@azad/shared';
import { AccessoryStockDialog } from './accessory-stock-dialog';

const h = vi.hoisted(() => ({ perms: new Set<string>(), detail: null as unknown, opening: vi.fn(), adjust: vi.fn(), toastError: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.has(p) }));
vi.mock('../hooks', () => ({
  useAccessory: () => ({ data: h.detail }),
  useAccessoryMutations: () => ({ openingStock: { mutateAsync: h.opening, isPending: false }, adjust: { mutateAsync: h.adjust, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

const base: AccessoryDetailDto = {
  id: 'a1', name: 'Helmet', sku: 'HEL-01', category: null, sellPrice: '150000', avgCost: '90000', onHand: 10, reserved: 3, available: 7, minStock: 2, lowStock: false,
  isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '', openingAllowed: true,
  movements: [
    { id: 'm2', accessoryId: 'a1', type: 'ADJUSTMENT', quantity: -2, unitCost: '90000', onHandAfter: 10, reservedAfter: 3, refType: null, refId: null, note: 'Damaged', createdByName: 'Owner', createdAt: '2026-10-16T10:00:00Z' },
    { id: 'm1', accessoryId: 'a1', type: 'OPENING', quantity: 12, unitCost: '90000', onHandAfter: 12, reservedAfter: 0, refType: null, refId: null, note: 'Opening stock', createdByName: 'Owner', createdAt: '2026-10-15T10:00:00Z' },
  ],
};
const show = (perms: string[], over: Partial<AccessoryDetailDto> = {}): void => {
  h.perms = new Set(perms);
  h.detail = { ...base, ...over };
  render(<AccessoryStockDialog id="a1" onOpenChange={() => {}} />);
};
const type = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); };
const OWNER = ['accessories.view', 'accessories.manage', 'inventory.cost'];
const MANAGER = ['accessories.view', 'accessories.manage'];

beforeEach(() => {
  h.opening.mockReset().mockResolvedValue({});
  h.adjust.mockReset().mockResolvedValue({});
  h.toastError.mockReset();
});
afterEach(cleanup);

describe('AccessoryStockDialog', () => {
  it('shows stock figures and the ledger; viewers get no controls and no cost', () => {
    show(['accessories.view']);
    const figures = within(screen.getByLabelText('Stock'));
    expect(figures.getByText('7')).toBeInTheDocument();
    expect(figures.queryByText('Avg cost')).toBeNull();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Adjustment')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('−2')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('+12')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Cost each' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Opening stock|Adjust stock/ })).toBeNull();
  });

  it('a manager adjusts but cannot enter opening stock (it sets the cost)', () => {
    show(MANAGER);
    expect(screen.getByRole('button', { name: /Adjust stock/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Opening stock/ })).toBeNull();
    expect(screen.getByText(/only the owner enters it/)).toBeInTheDocument();
  });

  it('the owner enters opening stock: rupees → paise', async () => {
    show(OWNER);
    expect(screen.getByRole('columnheader', { name: 'Cost each' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Opening stock/ }));
    type('Pieces in stock', '10');
    type('Cost of one piece (₹, without GST)', '899.50');
    type('Note (optional)', 'Counted');
    fireEvent.click(screen.getByRole('button', { name: 'Add opening stock' }));
    await waitFor(() => expect(h.opening).toHaveBeenCalledWith({ id: 'a1', body: { quantity: 10, unitCost: 89950, note: 'Counted' } }));
  });

  it('opening stock needs a cost', async () => {
    show(OWNER);
    fireEvent.click(screen.getByRole('button', { name: /Opening stock/ }));
    type('Pieces in stock', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Add opening stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the cost of one piece');
    expect(h.opening).not.toHaveBeenCalled();
  });

  it('opening stock is gone once anything else has moved', () => {
    show(OWNER, { openingAllowed: false });
    expect(screen.queryByRole('button', { name: /Opening stock/ })).toBeNull();
  });

  it('removing sends a negative adjustment with the reason', async () => {
    show(MANAGER);
    fireEvent.click(screen.getByRole('button', { name: /Adjust stock/ }));
    type('Pieces', '2');
    type('Reason', 'Damaged');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(h.adjust).toHaveBeenCalledWith({ id: 'a1', body: { delta: -2, reason: 'Damaged' } }));
  });

  it('adding sends a positive adjustment', async () => {
    show(MANAGER);
    fireEvent.click(screen.getByRole('button', { name: /Adjust stock/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Add/ }));
    type('Pieces', '4');
    type('Reason', 'Found in store');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(h.adjust).toHaveBeenCalledWith({ id: 'a1', body: { delta: 4, reason: 'Found in store' } }));
  });

  it('cannot remove reserved pieces, and needs a reason', async () => {
    show(MANAGER);
    fireEvent.click(screen.getByRole('button', { name: /Adjust stock/ }));
    expect(screen.getByText('Up to 7 can be removed (3 reserved for bookings).')).toBeInTheDocument();
    type('Pieces', '8');
    type('Reason', 'Write off');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 7 can be removed — 3 reserved for bookings');
    type('Pieces', '1');
    type('Reason', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason');
    expect(h.adjust).not.toHaveBeenCalled();
  });
});
