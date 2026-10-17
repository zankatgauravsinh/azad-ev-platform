import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import type { AccessoryDto } from '@azad/shared';
import { PurchaseFormDialog } from './purchase-form-dialog';

const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const h = vi.hoisted(() => ({ create: vi.fn(), createAccessory: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
const base = { sku: null, category: null, reserved: 0, minStock: 0, lowStock: false, isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '', sellPrice: '0', onHand: 0, available: 0 };
const catalogue: AccessoryDto[] = [{ ...base, id: H1, name: 'Helmet' }, { ...base, id: G1, name: 'Guard' }];
vi.mock('../hooks', () => ({ useAccessoryList: () => ({ data: catalogue }), useAccessoryMutations: () => ({ create: { mutateAsync: h.createAccessory } }) }));
vi.mock('../purchases-hooks', () => ({
  useAccessoryPurchaseMutations: () => ({ create: { mutateAsync: h.create, isPending: false } }),
  usePurchaseDefaults: () => ({ data: { rates: { [H1]: { gstRateBp: 1800, hsnCode: null }, [G1]: { gstRateBp: 500, hsnCode: null } } } }),
}));
vi.mock('@/features/finance/hooks', () => ({ useVendors: () => ({ data: { data: [{ id: V1, name: 'Studds' }] } }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode; 'aria-label'?: string; id?: string };
  return {
    Select: ({ value, onValueChange, children }: P) => {
      let label: string | undefined;
      let id: string | undefined;
      React.Children.forEach(children, (c) => { if (React.isValidElement(c)) { const props = c.props as P; label = label ?? props['aria-label']; id = id ?? props.id; } });
      return React.createElement('select', { value, id, 'aria-label': label, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, React.createElement('option', { value: '' }, '—'), children);
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const type = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); };
/** Type in the accessory box and pick the match. */
const add = (name: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Add an accessory' }), { target: { value: name } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}`) }));
};

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ id: 'p1', purchaseNumber: 'APU0001' });
  h.toastError.mockReset();
  h.createAccessory.mockReset();
});
afterEach(cleanup);

describe('PurchaseFormDialog', () => {
  it('records the bill: cost before GST, GST from the suggested rate or typed, unpaid by default', async () => {
    const onDone = vi.fn();
    render(<PurchaseFormDialog open onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: V1 } });
    type('Bill no. (optional)', 'SD/221');
    add('Helmet');
    add('Guard');
    expect((screen.getByLabelText('GST % of Helmet') as HTMLInputElement).value).toBe('18');
    expect((screen.getByLabelText('GST % of Guard') as HTMLInputElement).value).toBe('5');
    type('Quantity of Helmet', '5');
    type('Cost of Helmet', '1200');
    type('Quantity of Guard', '10');
    type('Cost of Guard', '200');
    type('GST amount of Guard', '360');
    expect(screen.getByLabelText('Purchase total')).toHaveTextContent('9,440.00'); // 6,000 + 1,080 + 2,000 + 360
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({
      vendorId: V1,
      vendorInvoiceNumber: 'SD/221',
      items: [
        { accessoryId: H1, quantity: 5, unitCost: 120000, gstRate: 18 },
        { accessoryId: G1, quantity: 10, unitCost: 20000, gstAmount: 36000 },
      ],
    });
    expect(h.create.mock.calls[0]![0].payment).toBeUndefined(); // unpaid
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('paid now sends the method, date and reference', async () => {
    render(<PurchaseFormDialog open onOpenChange={() => {}} />);
    add('Helmet');
    type('Cost of Helmet', '1000');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paid now' }));
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'UPI' } });
    type('Reference (optional)', 'UTR9');
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    await waitFor(() => expect(h.create.mock.calls[0]![0].payment).toMatchObject({ method: 'UPI', reference: 'UTR9' }));
  });

  it('needs a cost on every line and refuses a future bill date', async () => {
    render(<PurchaseFormDialog open onOpenChange={() => {}} />);
    add('Helmet');
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the cost of each accessory');
    type('Cost of Helmet', '10');
    type('Bill date', new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be in the future');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('typing a name not in the list adds it as a new accessory, then to the bill', async () => {
    const N1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    h.createAccessory.mockResolvedValue({ ...base, id: N1, name: 'Rear guard' });
    render(<PurchaseFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Add an accessory' }), { target: { value: 'Rear guard' } });
    expect(screen.queryByRole('option', { name: /^Helmet/ })).toBeNull(); // only matches are offered
    fireEvent.click(screen.getByRole('option', { name: /Add “Rear guard” as a new accessory/ }));
    await waitFor(() => expect(h.createAccessory).toHaveBeenCalledWith({ name: 'Rear guard', sku: null, category: null, sellPrice: 0, minStock: 0, isPart: false }));
    expect(await screen.findByLabelText('Cost of Rear guard')).toBeInTheDocument();
    expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('set its selling price'));
  });

  it('an existing name is picked, not created again', () => {
    render(<PurchaseFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Add an accessory' }), { target: { value: 'helmet' } });
    expect(screen.queryByRole('option', { name: /as a new accessory/ })).toBeNull();
    expect(screen.getByRole('option', { name: /^Helmet/ })).toBeInTheDocument();
  });
});
