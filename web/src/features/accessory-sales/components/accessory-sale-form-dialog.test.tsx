import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import type { AccessoryDto, AccessorySaleDefaults } from '@azad/shared';
import { AccessorySaleFormDialog } from './accessory-sale-form-dialog';

const C1 = '11111111-1111-4111-8111-111111111111';
const C9 = '99999999-9999-4999-8999-999999999999';
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const B1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const h = vi.hoisted(() => ({ create: vi.fn(), defaults: null as unknown, toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../hooks', () => ({
  useAccessorySaleDefaults: () => ({ data: h.defaults }),
  useAccessorySaleMutations: () => ({ create: { mutateAsync: h.create, isPending: false } }),
}));
const base = { sku: null, category: null, reserved: 0, minStock: 0, lowStock: false, isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '' };
const catalogue: AccessoryDto[] = [
  { ...base, id: H1, name: 'Helmet', sellPrice: '150000', onHand: 5, available: 5 },
  { ...base, id: G1, name: 'Guard', sellPrice: '50000', onHand: 1, available: 1 },
  { ...base, id: M1, name: 'Mat', sellPrice: '30000', onHand: 0, available: 0 },
];
vi.mock('@/features/accessories/hooks', () => ({ useAccessoryList: () => ({ data: catalogue }) }));
vi.mock('@/features/sales/components/customer-combobox', () => ({
  CustomerCombobox: ({ onChange }: { onChange: (id: string, label: string) => void }) => <button type="button" onClick={() => onChange(C1, 'Ravi')}>pick customer</button>,
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode; disabled?: boolean; 'aria-label'?: string };
  const Ctx = React.createContext<string | undefined>(undefined);
  return {
    Select: ({ value, onValueChange, children, disabled }: P) => {
      let label: string | undefined;
      React.Children.forEach(children, (c) => { if (React.isValidElement(c) && (c.props as P)['aria-label']) label = (c.props as P)['aria-label']; });
      return React.createElement(Ctx.Provider, { value: label }, React.createElement('select', { value, disabled, 'aria-label': label, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, React.createElement('option', { value: '' }, '—'), children));
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children, disabled }: P) => React.createElement('option', { value, disabled }, children),
  };
});

const defaults = (over: Partial<AccessorySaleDefaults> = {}): AccessorySaleDefaults => ({ gstEnabled: false, defaultGstRateBp: 1800, rates: {}, supplyType: 'INTRA', supplyTypeHint: '', bookings: [{ id: B1, code: 'BK0001', status: 'CONFIRMED' }], ...over });
const add = (id: string): void => { fireEvent.change(screen.getByLabelText('Add an accessory'), { target: { value: id } }); };

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ id: 's1', invoiceNumber: 'ACC0001' });
  h.toastError.mockReset();
  h.defaults = defaults();
});
afterEach(cleanup);

describe('AccessorySaleFormDialog', () => {
  it('adds lines at the catalogue price, takes changed prices and a part payment', async () => {
    const onDone = vi.fn();
    render(<AccessorySaleFormDialog open onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('pick customer'));
    add(H1);
    add(G1);
    expect((screen.getByLabelText('Price of Helmet') as HTMLInputElement).value).toBe('1500');
    fireEvent.change(screen.getByLabelText('Quantity of Helmet'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Price of Guard'), { target: { value: '450' } });
    expect(screen.getByLabelText('Invoice total')).toHaveTextContent('3,450');
    fireEvent.change(screen.getByLabelText('Booking'), { target: { value: B1 } });
    fireEvent.change(screen.getByLabelText('Paid now (₹)'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        customerId: C1,
        bookingId: B1,
        items: [{ accessoryId: H1, qty: 2, unitPrice: 150000 }, { accessoryId: G1, qty: 1, unitPrice: 45000 }],
        payment: { amount: 200000, mode: 'CASH' },
      }),
    );
    expect(onDone).toHaveBeenCalledWith('s1');
  });

  it('out-of-stock items cannot be picked, and quantities above what is available are refused', async () => {
    render(<AccessorySaleFormDialog open onOpenChange={() => {}} />);
    expect((screen.getByRole('option', { name: /Mat/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('pick customer'));
    add(G1);
    fireEvent.change(screen.getByLabelText('Quantity of Guard'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 of Guard available');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('with GST on, shows the GST inside the price and sends the supply type', async () => {
    h.defaults = defaults({ gstEnabled: true, rates: { [H1]: { gstRateBp: 1800, hsnCode: '6506' } } });
    render(<AccessorySaleFormDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByText('pick customer'));
    add(H1);
    const totals = screen.getByLabelText('Invoice total');
    expect(totals).toHaveTextContent('Taxable value');
    expect(totals).toHaveTextContent('1,271.19');
    expect(totals).toHaveTextContent('114.40');
    expect(totals).toHaveTextContent('114.41');
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(h.create.mock.calls[0]![0]).toMatchObject({ supplyType: 'INTRA' }));
  });

  it('paid now cannot exceed the total', async () => {
    render(<AccessorySaleFormDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByText('pick customer'));
    add(G1);
    fireEvent.change(screen.getByLabelText('Paid now (₹)'), { target: { value: '501' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be more than the total');
  });

  it('a preset customer (from the customer or booking page) is fixed', () => {
    render(<AccessorySaleFormDialog open onOpenChange={() => {}} preset={{ customerId: C9, customerName: 'Asha', bookingId: B1 }} />);
    expect((screen.getByLabelText('Customer') as HTMLInputElement).value).toBe('Asha');
    expect(screen.queryByText('pick customer')).toBeNull();
    expect((screen.getByLabelText('Booking') as HTMLSelectElement).value).toBe(B1);
  });
});
