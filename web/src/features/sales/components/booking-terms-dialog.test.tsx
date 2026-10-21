import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BookingTermsDialog } from './booking-terms-dialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ revise: vi.fn() }));
vi.mock('../api', () => ({ salesApi: { reviseBookingTerms: (...a: any[]) => h.revise(...a), salesExecutives: async () => [{ id: 's1', name: 'Sam' }] } }));
vi.mock('../hooks', () => ({ useSalesInvalidate: () => () => {} }));
vi.mock('@/features/inventory/hooks', () => ({ useAvailableUnits: () => ({ data: { data: [] } }) }));
vi.mock('./customer-combobox', () => ({ CustomerCombobox: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [{ id: 's1', name: 'Sam' }] }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const booking: any = {
  id: 'b1', code: 'BK-1', status: 'CONFIRMED',
  customer: { id: 'c1', name: 'Asha' }, salesExecutive: { id: 's1', name: 'Sam' }, rtoInvoice: null,
  unit: { id: 'u1', vin: 'V1', variant: { name: 'Pro', colour: 'Red', model: { name: 'VX' } } },
  exShowroom: '950000', discount: '0', exchangeValue: '0', rto: '50000', insuranceCharge: '0', registration: '0', extendedWarranty: '0',
  accessoriesTotal: '0', total: '1000000', paymentSummary: { paid: '200000', total: '1000000', balance: '800000', status: 'PARTIAL' },
};

const input = (name: string): HTMLInputElement => document.querySelector(`[name="${name}"]`) as HTMLInputElement;

beforeEach(() => { h.revise.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

describe('BookingTermsDialog', () => {
  it('sends only the changed prices with the reason, and shows old → new total', async () => {
    render(<BookingTermsDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(input('discount'), { target: { value: '500' } });
    expect(screen.getAllByText(/9,500/).length).toBeGreaterThanOrEqual(2); // the estimate and the new total
    fireEvent.change(input('reason'), { target: { value: 'Festival offer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.revise).toHaveBeenCalledTimes(1));
    expect(h.revise.mock.calls[0]).toEqual(['b1', { reason: 'Festival offer', discount: 50000 }]);
  });

  it('needs a reason, and refuses a total below what was received', () => {
    render(<BookingTermsDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(input('discount'), { target: { value: '500' } });
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input('reason'), { target: { value: 'Too big' } });
    fireEvent.change(input('discount'), { target: { value: '9000' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/less than what has already been received/);
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the customer and scooter fixed once an RTO invoice exists', () => {
    render(<BookingTermsDialog open onOpenChange={() => {}} booking={{ ...booking, rtoInvoice: { id: 'r1', invoiceNumber: 'RTO-7', total: '0', revision: 1 } }} />);
    expect((screen.getByDisplayValue('Asha') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/RTO invoice RTO-7 names this customer and scooter/)).toBeInTheDocument();
  });
});
