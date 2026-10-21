import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RegenerateInvoiceGstDialog } from './regenerate-invoice-gst-dialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ preview: { current: null as any }, regenerate: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: h.preview.current, isLoading: false, refetch: vi.fn() }) }));
vi.mock('../api', () => ({ salesApi: { regenerateInvoiceGst: (...a: any[]) => h.regenerate(...a) } }));
vi.mock('../hooks', () => ({ useSalesInvalidate: () => () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const proposed = {
  version: 1, supplyType: 'INTRA', placeOfSupply: '24-Gujarat', buyerName: 'Kavya', buyerGstin: null, taxable: '10000000', cgst: '250000', sgst: '250000', igst: '0', totalTax: '500000',
  lines: [{ description: 'Electric scooter', code: '87116010', codeType: 'HSN', ratePercent: '5.00', treatment: 'TAXABLE', taxable: '10000000', tax: '500000' }],
};
const preview = (over: Record<string, unknown> = {}) => ({ invoiceNumber: 'INV0016', invoiceDate: '2026-09-02', total: '10500000', current: null, proposed, blocker: null, unchanged: false, ...over });

beforeEach(() => { h.regenerate.mockReset().mockResolvedValue({}); h.preview.current = preview(); });
afterEach(cleanup);

describe('RegenerateInvoiceGstDialog', () => {
  it('shows the breakdown the invoice would get (same number, date, total) and needs a reason', async () => {
    render(<RegenerateInvoiceGstDialog open onOpenChange={() => {}} bookingId="b1" />);
    expect(screen.getByText(/Invoice INV0016 dated .* keeps its number, date and total \(₹1,05,000.00\)/)).toBeInTheDocument();
    expect(screen.getByText('The invoice has no GST breakdown now.')).toBeInTheDocument();
    expect(screen.getByText('B2C — unregistered buyer')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Regenerate invoice' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Invoiced before GST was set up' } });
    fireEvent.click(button);
    await waitFor(() => expect(h.regenerate).toHaveBeenCalledWith('b1', { reason: 'Invoiced before GST was set up' }));
  });

  it('explains why it cannot be done, without the action', () => {
    h.preview.current = preview({ proposed: null, blocker: 'GSTR-1 for 2026-09 is marked filed — unlock the month in GST first' });
    render(<RegenerateInvoiceGstDialog open onOpenChange={() => {}} bookingId="b1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('GSTR-1 for 2026-09 is marked filed');
    expect(screen.queryByRole('button', { name: 'Regenerate invoice' })).toBeNull();
  });

  it('says so when nothing would change', () => {
    h.preview.current = preview({ current: proposed, proposed: { ...proposed, version: 2 }, unchanged: true });
    render(<RegenerateInvoiceGstDialog open onOpenChange={() => {}} bookingId="b1" />);
    expect(screen.getByText(/already up to date/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate invoice' })).toBeNull();
  });
});
