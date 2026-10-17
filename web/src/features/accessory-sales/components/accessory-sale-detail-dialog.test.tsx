import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AccessorySaleDetailDto } from '@azad/shared';
import { AccessorySaleDetailDialog } from './accessory-sale-detail-dialog';

const h = vi.hoisted(() => ({ perms: new Set<string>(), sale: null as unknown, pay: vi.fn(), cancel: vi.fn(), pdf: vi.fn(), save: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.has(p) }));
vi.mock('../hooks', () => ({
  useAccessorySale: () => ({ data: h.sale }),
  useAccessorySaleMutations: () => ({ addPayment: { mutateAsync: h.pay, isPending: false }, cancel: { mutateAsync: h.cancel, isPending: false } }),
}));
vi.mock('../api', () => ({ accessorySalesApi: { pdf: h.pdf } }));
vi.mock('@/lib/download', () => ({ saveBlob: h.save }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sale: AccessorySaleDetailDto = {
  id: 's1', invoiceNumber: 'ACC0001', invoiceDate: '2026-10-16T10:00:00Z', status: 'ACTIVE', customer: { id: 'c1', name: 'Ravi', phone: '9000000001' }, booking: { id: 'b1', code: 'BK0001' },
  gstApplied: true, supplyType: 'INTRA', subtotal: '127119', cgst: '11440', sgst: '11441', igst: '0', gstAmount: '22881', total: '150000', paid: '100000', refunded: '0', balance: '50000',
  paymentStatus: 'PARTIAL', itemCount: 1, itemsSummary: 'Helmet', notes: null, cancelledAt: null, cancelReason: null, cancelledByName: null, createdByName: 'Sam', createdAt: '',
  items: [{ id: 'i1', accessoryId: 'h1', name: 'Helmet', sku: 'HEL-01', hsnCode: '6506', qty: 1, unitPrice: '150000', gstRateBp: 1800, taxable: '127119', gstAmount: '22881', lineTotal: '150000' }],
  payments: [{ id: 'p1', receiptNumber: 'RC0009', amount: '100000', mode: 'CASH', reference: null, paidAt: '2026-10-16T10:00:00Z', receivedByName: 'Sam' }],
  refunds: [],
};
const show = (perms: string[], over: Partial<AccessorySaleDetailDto> = {}): void => {
  h.perms = new Set(perms);
  h.sale = { ...sale, ...over };
  render(<AccessorySaleDetailDialog id="s1" onOpenChange={() => {}} />);
};

beforeEach(() => {
  h.pay.mockReset().mockResolvedValue({});
  h.cancel.mockReset().mockResolvedValue({});
  h.pdf.mockReset().mockResolvedValue(new Blob(['%PDF']));
  h.save.mockReset();
});
afterEach(cleanup);

describe('AccessorySaleDetailDialog', () => {
  it('shows lines, GST split, paid and balance; viewers only download the invoice', async () => {
    show(['accessories.view']);
    expect(screen.getByText('Part paid')).toBeInTheDocument();
    expect(screen.getByLabelText('Totals')).toHaveTextContent('CGST');
    expect(screen.getByLabelText('Totals')).toHaveTextContent('500.00'); // balance
    expect(screen.queryByRole('button', { name: /Record payment/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel sale/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Invoice/ }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.any(Blob), 'accessory-invoice-ACC0001.pdf'));
  });

  it('sales staff record the balance (defaults to what is due)', async () => {
    show(['accessories.view', 'accessories.sell']);
    expect(screen.queryByRole('button', { name: /Cancel sale/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).value).toBe('500');
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.pay).toHaveBeenCalledWith({ id: 's1', body: { amount: 50000, mode: 'CASH' } }));
  });

  it('owner / manager cancel with a reason; what was paid is refunded', async () => {
    show(['accessories.view', 'accessories.cancel']);
    fireEvent.click(screen.getByRole('button', { name: /Cancel sale/ }));
    expect(screen.getByText(/the ₹1,000.00 paid is refunded/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong item billed' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel sale' }).at(-1)!);
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith({ id: 's1', body: { reason: 'Wrong item billed', refundMode: 'CASH' } }));
  });

  it('a cancelled sale says so and offers no actions', () => {
    show(['accessories.view', 'accessories.sell', 'accessories.cancel'], { status: 'CANCELLED', cancelReason: 'Returned', cancelledAt: '2026-10-17T10:00:00Z', refunded: '100000', balance: '0', refunds: [{ id: 'r1', refundNumber: 'RF0001', amount: '100000', method: 'CASH', reference: null, refundedAt: '2026-10-17T10:00:00Z' }] });
    expect(screen.getByRole('note')).toHaveTextContent('Returned');
    expect(screen.getByText('RF0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record payment|Cancel sale/ })).toBeNull();
  });
});
