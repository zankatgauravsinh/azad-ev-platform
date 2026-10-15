import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { RtoInvoiceDto } from '@azad/shared';
import { RtoInvoiceFormDialog } from './rto-invoice-form-dialog';
import { RtoInvoiceDetailDialog } from './rto-invoice-detail-dialog';

const h = vi.hoisted(() => ({
  defaults: vi.fn(),
  detail: vi.fn(),
  generate: vi.fn(),
  revise: vi.fn(),
  user: { current: { role: 'OWNER' } as { role: string } },
  perms: { current: new Set<string>(['rto.view', 'rto.generate', 'rto.edit']) },
}));
vi.mock('../api', () => ({ rtoApi: { defaults: (...a: unknown[]) => h.defaults(...a), detail: (...a: unknown[]) => h.detail(...a), pdf: vi.fn(), generate: (b: unknown) => h.generate(b), revise: (id: string, b: unknown) => h.revise(id, b) } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: h.user.current, can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const invoice: RtoInvoiceDto = {
  id: 'r1', invoiceNumber: 'RTO0001', invoiceDate: '2026-10-15T06:00:00.000Z',
  booking: { id: 'b1', code: 'BK0001', status: 'CONFIRMED' },
  customer: { id: 'c1', name: 'Asha Patel', phone: '9876543210' },
  vehicle: { model: 'VX1', variant: 'Pro', colour: 'Teal', vin: 'VIN123', motorNumber: 'M1', batteryNumber: 'B1' },
  listPrice: '10000000', discount: '0', sellingPrice: '10000000', gstRate: 5, supplyType: 'INTRA', cgst: '250000', sgst: '250000', igst: '0', gstAmount: '500000', total: '10500000',
  hsnCode: '87116020', policyNumber: 'POL-1', deliveryDate: '2026-10-14', revision: 1, createdBy: 'Owner', createdAt: '2026-10-15T06:00:00.000Z', updatedBy: 'Owner', updatedAt: '2026-10-15T06:00:00.000Z',
};

function Where(): JSX.Element { return <p data-testid="where">{useLocation().pathname}</p>; }
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/rto-invoices']}><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.defaults.mockReset().mockResolvedValue({ listPrice: '11800000', gstRate: 5, supplyType: 'INTRA', supplyTypeHint: 'The customer is in your state (GST state code 24).', policyNumber: 'POL-1', deliveryDate: '2026-10-14', deliveryDateSource: 'DELIVERED', existing: null });
  h.detail.mockReset().mockResolvedValue(invoice);
  h.generate.mockReset().mockResolvedValue(invoice);
  h.revise.mockReset().mockResolvedValue({ ...invoice, revision: 2 });
  h.user.current = { role: 'OWNER' };
  h.perms.current = new Set(['rto.view', 'rto.generate', 'rto.edit']);
});
afterEach(cleanup);

describe('RtoInvoiceFormDialog — generate from a booking', () => {
  it("starts from the scooter's list price and previews GST on top", async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('List price (₹)') as HTMLInputElement).value).toBe('118000'));
    expect((screen.getByLabelText('GST rate (%)') as HTMLInputElement).value).toBe('5');
    expect(screen.getByText('The customer is in your state (GST state code 24).')).toBeInTheDocument();
    const summary = screen.getByLabelText('Invoice amount');
    expect(summary).toHaveTextContent('CGST @ 2.50%₹2,950.00');
    expect(summary).toHaveTextContent('Total₹1,23,900.00');

    // The owner changes the price; the preview follows.
    fireEvent.change(screen.getByLabelText('List price (₹)'), { target: { value: '100000' } });
    expect(summary).toHaveTextContent('Total₹1,05,000.00');
  });

  it('sends the entered figures in paise and opens the new invoice', async () => {
    const onDone = vi.fn();
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={onDone} />);
    await waitFor(() => expect((screen.getByLabelText('List price (₹)') as HTMLInputElement).value).toBe('118000'));
    fireEvent.change(screen.getByLabelText('List price (₹)'), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText('GST rate (%)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalledWith({ customerId: 'c1', bookingId: 'b1', listPrice: 10_000_000, discount: 0, gstRate: 12, supplyType: 'INTRA', policyNumber: 'POL-1', deliveryDate: '2026-10-14' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('r1'));
  });

  it('list price − discount is the basic price; GST is added on that', async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('List price (₹)') as HTMLInputElement).value).toBe('118000'));
    fireEvent.change(screen.getByLabelText('List price (₹)'), { target: { value: '139000' } });
    fireEvent.change(screen.getByLabelText('Discount (₹)'), { target: { value: '4000' } });
    const summary = screen.getByLabelText('Invoice amount');
    expect(summary).toHaveTextContent('Basic price (taxable value)₹1,35,000.00');
    expect(summary).toHaveTextContent('Total₹1,41,750.00');
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalledWith({ customerId: 'c1', bookingId: 'b1', listPrice: 13_900_000, discount: 400_000, gstRate: 5, supplyType: 'INTRA', policyNumber: 'POL-1', deliveryDate: '2026-10-14' }));
  });

  it('refuses a discount that is not below the list price', async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('List price (₹)') as HTMLInputElement).value).toBe('118000'));
    fireEvent.change(screen.getByLabelText('Discount (₹)'), { target: { value: '118000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    expect(await screen.findByText('The discount must be less than the list price')).toBeInTheDocument();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('refuses a rate above 28% before sending', async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('GST rate (%)') as HTMLInputElement).value).toBe('5'));
    fireEvent.change(screen.getByLabelText('GST rate (%)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    expect(await screen.findByText('Enter a rate from 0 to 28%')).toBeInTheDocument();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('a booking that already has one offers to open it instead', async () => {
    h.defaults.mockResolvedValue({ listPrice: '1', gstRate: 5, supplyType: 'INTRA', supplyTypeHint: '', existing: { id: 'r1', invoiceNumber: 'RTO0001' } });
    const onDone = vi.fn();
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={onDone} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('already has RTO invoice RTO0001');
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onDone).toHaveBeenCalledWith('r1');
  });
});

describe('RtoInvoiceFormDialog — owner revision', () => {
  it('keeps the number and sends only the new figures', async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} invoice={invoice} onDone={() => {}} />);
    expect(screen.getByText('Edit RTO invoice RTO0001')).toBeInTheDocument();
    expect((screen.getByLabelText('List price (₹)') as HTMLInputElement).value).toBe('100000');
    fireEvent.change(screen.getByLabelText('List price (₹)'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate invoice' }));
    await waitFor(() => expect(h.revise).toHaveBeenCalledWith('r1', { listPrice: 12_000_000, discount: 0, gstRate: 5, supplyType: 'INTRA', policyNumber: 'POL-1', deliveryDate: '2026-10-14' }));
    expect(h.defaults).not.toHaveBeenCalled();
  });
});

describe('RtoInvoiceDetailDialog', () => {
  it('shows every detail, and View booking opens the booking', async () => {
    wrap(<RtoInvoiceDetailDialog id="r1" onOpenChange={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('RTO invoice RTO0001'));
    for (const text of ['Asha Patel', 'BK0001', 'VX1 Pro · Teal', 'VIN123', 'HSN 87116020', '₹1,00,000.00', '₹2,500.00', '₹1,05,000.00']) expect(dialog).toHaveTextContent(text);
    expect(dialog).not.toHaveTextContent('Discount'); // no discount, no discount lines
    fireEvent.click(screen.getByRole('button', { name: 'View booking' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/bookings/b1');
  });

  it('only the owner is offered Edit & regenerate', async () => {
    wrap(<RtoInvoiceDetailDialog id="r1" onOpenChange={() => {}} />);
    expect(await screen.findByRole('button', { name: /Edit & regenerate/ })).toBeInTheDocument();
    cleanup();
    h.user.current = { role: 'MANAGER' };
    h.perms.current = new Set(['rto.view', 'rto.generate']);
    wrap(<RtoInvoiceDetailDialog id="r1" onOpenChange={() => {}} />);
    await screen.findByRole('button', { name: 'View booking' });
    expect(screen.queryByRole('button', { name: /Edit & regenerate/ })).toBeNull();
  });
});

describe('RtoInvoiceFormDialog — policy number and delivery date', () => {
  it("start from the booking; the owner can change the delivery date", async () => {
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Delivery date') as HTMLInputElement).value).toBe('2026-10-14'));
    expect((screen.getByLabelText('Insurance policy no.') as HTMLInputElement).value).toBe('POL-1');
    expect(screen.getByLabelText('Delivery date')).not.toBeDisabled();
    expect(screen.getByText("The booking's delivery date. As the owner, you can change it.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Delivery date'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('Insurance policy no.'), { target: { value: 'POL-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ policyNumber: 'POL-2', deliveryDate: '2026-10-10' })));
  });

  it("a manager sees the booking's date but cannot change it, and does not send one", async () => {
    h.user.current = { role: 'MANAGER' };
    h.perms.current = new Set(['rto.view', 'rto.generate']);
    h.defaults.mockResolvedValue({ listPrice: '11800000', gstRate: 5, supplyType: 'INTRA', supplyTypeHint: '', policyNumber: null, deliveryDate: '2026-11-20', deliveryDateSource: 'EXPECTED', existing: null });
    wrap(<RtoInvoiceFormDialog open onOpenChange={() => {}} preset={{ customerId: 'c1', bookingId: 'b1' }} onDone={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Delivery date') as HTMLInputElement).value).toBe('2026-11-20'));
    expect(screen.getByLabelText('Delivery date')).toBeDisabled();
    expect(screen.getByText("The booking's expected delivery date (not delivered yet). Only the owner can change it.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Insurance policy no.'), { target: { value: 'POL-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalled());
    expect(h.generate.mock.calls[0]![0]).toMatchObject({ policyNumber: 'POL-9' });
    expect(h.generate.mock.calls[0]![0]).not.toHaveProperty('deliveryDate');
  });
});
