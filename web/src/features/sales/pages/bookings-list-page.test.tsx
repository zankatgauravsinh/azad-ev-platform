import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BookingsListPage } from './bookings-list-page';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, row: { current: null as any } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const fullUnit = {
  id: 'u1', vin: 'V1', motorNumber: 'M1', batteryNumber: 'B1', status: 'BOOKED',
  purchaseDate: null, sellingPrice: '100000', location: 'Yard', notes: 'Scratch on panel',
  variant: { id: 'var1', name: 'Pro', colour: 'Red', hexColour: '#ff0000', batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: '4.5', motorPowerW: 2500, warrantyMonths: 36, model: { id: 'm1', name: 'VX', brand: 'AZAD', description: 'City EV' } },
};
const makeRow = (over: Record<string, any> = {}): any => ({
  id: 'b1', code: 'BK-1', customer: { name: 'Asha', phone: '98' }, unit: fullUnit,
  total: '100000', paymentSummary: { status: 'PARTIAL', paid: '10000', balance: '90000' },
  status: 'CONFIRMED', expectedDelivery: null, sale: null, actualDelivery: null,
  ...over,
});
vi.mock('../hooks', () => ({ useBookings: () => ({ data: { data: [h.row.current], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isLoading: false, isFetching: false }) }));
vi.mock('../components/booking-form-dialog', () => ({ BookingFormDialog: () => null }));

const renderWith = (perms: string[], over: Record<string, any> = {}): void => {
  cleanup();
  h.perms.current = new Set(perms);
  h.row.current = makeRow(over);
  render(<MemoryRouter><BookingsListPage /></MemoryRouter>);
};
const newBtn = () => screen.queryByRole('button', { name: /New booking/ });
beforeEach(() => { h.perms.current = new Set(); h.row.current = makeRow(); });

describe('BookingsListPage permission gating', () => {
  it('view-only hides New booking', () => {
    renderWith(['bookings.view']);
    expect(newBtn()).toBeNull();
  });
  it('bookings.create shows New booking', () => {
    renderWith(['bookings.view', 'bookings.create']);
    expect(newBtn()).not.toBeNull();
  });
});

describe('BookingsListPage columns & vehicle details', () => {
  it('shows Total, Paid and Pending amounts', () => {
    renderWith(['bookings.view']);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('₹1,000'); // total 100000 paise
    expect(table).toHaveTextContent('₹100'); // paid 10000 paise
    expect(table).toHaveTextContent('₹900'); // pending 90000 paise
  });

  it('shows a Pending Delivery badge for a converted, undelivered booking (distinct from status)', () => {
    renderWith(['bookings.view'], { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'INVOICED', invoicedAt: null } });
    expect(screen.getByText('Pending Delivery')).toBeInTheDocument();
  });

  it('shows a Delivered badge once the vehicle is delivered', () => {
    renderWith(['bookings.view'], { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'DELIVERED', invoicedAt: null }, actualDelivery: '2026-02-01T00:00:00.000Z' });
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('does not present a cancelled booking balance as an active Pending amount', () => {
    renderWith(['bookings.view'], { status: 'CANCELLED' });
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('—'); // Pending shown as a dash, not an owed amount
    expect(table).not.toHaveTextContent('₹900'); // the 90000-paise shortfall is not shown
    expect(table).toHaveTextContent('₹100'); // amount received (retained) is still shown
  });

  it('opens the Vehicle Details modal from the row action with identification + notes', () => {
    renderWith(['bookings.view']);
    fireEvent.click(screen.getByRole('button', { name: /View vehicle details/ }));
    // Assert on fields unique to the modal (VIN also shows in the row's Vehicle column).
    expect(screen.getByText('M1')).toBeInTheDocument(); // motor no.
    expect(screen.getByText('B1')).toBeInTheDocument(); // battery no.
    expect(screen.getByText('Scratch on panel')).toBeInTheDocument(); // vehicle notes
  });
});
