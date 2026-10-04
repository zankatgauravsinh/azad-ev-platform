import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BookingFormDialog } from './booking-form-dialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn() }));
vi.mock('../api', () => ({ salesApi: { updateBooking: (...a: any[]) => h.update(...a), createBooking: (...a: any[]) => h.create(...a) } }));
vi.mock('../hooks', () => ({ useSalesInvalidate: () => () => {} }));
vi.mock('@/features/inventory/hooks', () => ({ useAvailableUnits: () => ({ data: { data: [] } }) }));
vi.mock('./customer-combobox', () => ({ CustomerCombobox: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const booking: any = {
  id: 'b1', code: 'BK-1', status: 'CONFIRMED',
  customer: { id: 'c1', name: 'Asha' },
  unit: { id: 'u1', vin: 'V1', variant: { name: 'Pro', model: { name: 'VX' } } },
  exShowroom: '950000', discount: '0', exchangeValue: '0', rto: '50000', insuranceCharge: '0', registration: '0', extendedWarranty: '0',
  total: '1000000', advanceAmount: '0', financeRequired: false, insuranceRequired: false, expectedDelivery: null, notes: 'orig',
};

beforeEach(() => { h.update.mockReset().mockResolvedValue({}); h.create.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

describe('BookingFormDialog — pricing lock on edit', () => {
  it('create mode exposes the pricing fields', () => {
    render(<BookingFormDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/Ex-showroom/)).toBeInTheDocument();
  });

  it('edit mode hides pricing fields and states pricing is fixed', () => {
    render(<BookingFormDialog open onOpenChange={() => {}} booking={booking} />);
    expect(screen.queryByText(/Ex-showroom/)).toBeNull();
    expect(screen.queryByText(/Discount/)).toBeNull();
    expect(screen.getByText(/pricing is fixed after booking/)).toBeInTheDocument();
    // Customer is shown read-only (disabled).
    expect((screen.getByDisplayValue('Asha') as HTMLInputElement).disabled).toBe(true);
  });

  it('edit submit sends only non-financial fields — never pricing/accessories/advance', async () => {
    render(<BookingFormDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(document.querySelector('textarea[name="notes"]') as HTMLTextAreaElement, { target: { value: 'updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const [id, payload] = h.update.mock.calls[0]!;
    expect(id).toBe('b1');
    expect(Object.keys(payload).sort()).toEqual(['expectedDelivery', 'financeRequired', 'insuranceRequired', 'notes']);
    expect(payload.notes).toBe('updated note');
    // No commercial-term keys leak into the edit payload.
    for (const k of ['exShowroom', 'discount', 'exchangeValue', 'rto', 'insurance', 'registration', 'extendedWarranty', 'accessories', 'advanceAmount', 'customerId', 'unitId', 'total']) {
      expect(payload).not.toHaveProperty(k);
    }
  });
});
