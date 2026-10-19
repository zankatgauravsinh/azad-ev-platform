import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VendorBillDto, VendorPaymentDto } from '@azad/shared';
import { PayVendorDialog } from './pay-vendor-dialog';

const h = vi.hoisted(() => ({ bills: [] as unknown[], pay: vi.fn(), apply: vi.fn() }));
vi.mock('../payables-hooks', () => ({
  useVendorBills: () => ({ data: h.bills, isLoading: false }),
  useVendorPaymentMutations: () => ({ pay: { mutateAsync: h.pay, isPending: false }, apply: { mutateAsync: h.apply, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const bill = (over: Partial<VendorBillDto>): VendorBillDto => ({
  kind: 'SCOOTER', id: 'u1', vendorId: 'v1', number: 'VIN001', vendorBillNumber: null, description: 'Ather 450 (Red)', date: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-10-01T00:00:00.000Z', amount: '10700000', allocated: '0', balance: '10700000', paid: false, paidAt: null, daysOverdue: 18, ...over,
});

beforeEach(() => {
  h.bills = [bill({}), bill({ kind: 'ACCESSORY_PURCHASE', id: 'p1', number: 'APU0001', description: 'Helmet × 10', amount: '590000', balance: '590000', daysOverdue: -5 })];
  h.pay.mockReset().mockResolvedValue({ paymentNumber: 'VPY0001' });
  h.apply.mockReset().mockResolvedValue({ paymentNumber: 'VPY0001' });
});
afterEach(cleanup);

describe('PayVendorDialog', () => {
  it('pays the ticked bills; the amount follows them; overdue and due-in shown', async () => {
    render(<PayVendorDialog open onOpenChange={() => {}} vendorId="v1" vendorName="Comptech" preselect={[{ kind: 'SCOOTER', id: 'u1' }]} />);
    expect(screen.getByText('18 days overdue')).toBeInTheDocument();
    expect(screen.getByText('Due in 5 days')).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText('Amount paid (₹)') as HTMLInputElement).value).toBe('107000'));
    fireEvent.click(screen.getByLabelText('Pay APU0001'));
    fireEvent.change(screen.getByLabelText('Amount paying on APU0001'), { target: { value: '2000' } }); // part of it
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: 'v1',
        amount: 10_700_000 + 200_000,
        allocations: [{ kind: 'SCOOTER', billId: 'u1', amount: 10_700_000 }, { kind: 'ACCESSORY_PURCHASE', billId: 'p1', amount: 200_000 }],
      })),
    );
  });

  it('what is paid above the bills stays as an advance; paying less than the bills is refused', async () => {
    render(<PayVendorDialog open onOpenChange={() => {}} vendorId="v1" vendorName="Comptech" />);
    fireEvent.click(screen.getByLabelText('Pay APU0001'));
    fireEvent.change(screen.getByLabelText('Amount paid (₹)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('more than the amount paid');
    fireEvent.change(screen.getByLabelText('Amount paid (₹)'), { target: { value: '10000' } });
    expect(screen.getByLabelText('Payment summary')).toHaveTextContent('Kept as advance₹4,100');
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 1_000_000, allocations: [{ kind: 'ACCESSORY_PURCHASE', billId: 'p1', amount: 590_000 }] })));
  });

  it('applies an earlier advance to bills, within what is left', async () => {
    const advance = { id: 'pay1', paymentNumber: 'VPY0003', unapplied: '600000' } as VendorPaymentDto;
    render(<PayVendorDialog open onOpenChange={() => {}} vendorId="v1" vendorName="Comptech" applyFrom={advance} />);
    expect(screen.queryByLabelText('Amount paid (₹)')).toBeNull();
    fireEvent.click(screen.getByLabelText('Pay VIN001'));
    // Ticked: what is left of the advance, not the whole bill.
    expect((screen.getByLabelText('Amount paying on VIN001') as HTMLInputElement).value).toBe('6000');
    fireEvent.change(screen.getByLabelText('Amount paying on VIN001'), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply advance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only ₹6,000 of the advance is left');
    fireEvent.change(screen.getByLabelText('Amount paying on VIN001'), { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply advance' }));
    await waitFor(() => expect(h.apply).toHaveBeenCalledWith({ id: 'pay1', body: { allocations: [{ kind: 'SCOOTER', billId: 'u1', amount: 600_000 }] } }));
  });
});
