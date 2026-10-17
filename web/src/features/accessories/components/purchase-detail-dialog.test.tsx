import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AccessoryPurchaseDetailDto } from '@azad/shared';
import { PurchaseDetailDialog } from './purchase-detail-dialog';

const h = vi.hoisted(() => ({ data: null as unknown, pay: vi.fn(), cancel: vi.fn() }));
vi.mock('../purchases-hooks', () => ({
  useAccessoryPurchase: () => ({ data: h.data }),
  useAccessoryPurchaseMutations: () => ({ pay: { mutateAsync: h.pay, isPending: false }, cancel: { mutateAsync: h.cancel, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const purchase: AccessoryPurchaseDetailDto = {
  id: 'p1', purchaseNumber: 'APU0001', vendorInvoiceNumber: 'SD/221', vendorId: 'v1', vendorName: 'Studds', purchaseDate: '2026-10-16T00:00:00.000Z', notes: null, status: 'ACTIVE',
  subtotal: '600000', gstAmount: '108000', total: '708000', paid: false, paidAt: null, paymentMethod: null, paymentReference: null, itemCount: 5, itemsSummary: 'Helmet × 5',
  cancelledAt: null, cancelReason: null, cancelledByName: null, createdByName: 'Owner', createdAt: '',
  items: [{ id: 'i1', accessoryId: 'h1', accessoryName: 'Helmet', sku: null, quantity: 5, unitCost: '120000', gstRateBp: 1800, gstAmount: '108000', lineTotal: '708000' }],
};
const show = (over: Partial<AccessoryPurchaseDetailDto> = {}): void => {
  h.data = { ...purchase, ...over };
  render(<PurchaseDetailDialog id="p1" onOpenChange={() => {}} />);
};

beforeEach(() => {
  h.pay.mockReset().mockResolvedValue({});
  h.cancel.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('PurchaseDetailDialog', () => {
  it('shows the bill, unpaid; marks it paid', async () => {
    show();
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.getByLabelText('Bill totals')).toHaveTextContent('7,080.00');
    fireEvent.click(screen.getByRole('button', { name: /Mark paid/ }));
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'V7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.pay).toHaveBeenCalledWith({ id: 'p1', body: expect.objectContaining({ method: 'CASH', reference: 'V7' }) }));
  });

  it('cancels with a reason', async () => {
    show({ paid: true, paidAt: '2026-10-16T00:00:00.000Z', paymentMethod: 'CASH' });
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    expect(screen.getByText(/Paid .* by Cash/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancel purchase/ }));
    expect(screen.getByText(/record the vendor’s refund/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel purchase' }).at(-1)!);
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith({ id: 'p1', body: { reason: 'Entered twice' } }));
  });

  it('a cancelled purchase offers no actions', () => {
    show({ status: 'CANCELLED', cancelReason: 'Entered twice', cancelledAt: '2026-10-17T10:00:00Z' });
    expect(screen.getByRole('note')).toHaveTextContent('Entered twice');
    expect(screen.queryByRole('button', { name: /Mark paid|Cancel purchase/ })).toBeNull();
  });
});
