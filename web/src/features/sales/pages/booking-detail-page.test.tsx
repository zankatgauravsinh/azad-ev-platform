import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingDetailPage } from './booking-detail-page';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, booking: { current: null as any }, deliver: vi.fn(), invoicePdf: vi.fn(), note: vi.fn(), openBlob: vi.fn(), saveBlob: vi.fn(), printBlob: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const fullUnit = {
  id: 'u1', vin: 'V1', motorNumber: 'M1', batteryNumber: 'B1', status: 'BOOKED',
  purchaseDate: null, sellingPrice: '100000', location: 'Yard', notes: 'Minor scratch on left panel',
  variant: { id: 'var1', name: 'Pro', colour: 'Red', hexColour: '#ff0000', batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: '4.5', motorPowerW: 2500, warrantyMonths: 36, model: { id: 'm1', name: 'VX', brand: 'AZAD', description: 'City EV' } },
};
const makeBooking = (over: Record<string, any> = {}): any => ({
  id: 'b1', code: 'BK-1', status: 'CONFIRMED',
  paymentSummary: { status: 'PARTIAL', paid: '500', balance: '500' },
  unit: fullUnit,
  exShowroom: 1000n, discount: 0n, exchangeValue: 0n, accessoriesTotal: 0n, rto: 0n, insuranceCharge: 0n, registration: 0n, extendedWarranty: 0n,
  total: 1000n, payments: [], customer: { id: 'c1', name: 'Asha', phone: '98' },
  expectedDelivery: null, actualDelivery: null, sale: null, finance: null, insurance: null, pendingDocuments: null,
  ...over,
});

vi.mock('../hooks', () => ({ useBooking: () => ({ data: h.booking.current, isLoading: false }), useSalesInvalidate: () => () => {} }));
vi.mock('../components/booking-dialogs', () => ({ PaymentDialog: () => null, FinanceDialog: () => null, InsuranceDialog: () => null, ScheduleDeliveryDialog: () => null, CancelBookingDialog: () => null }));
vi.mock('../components/booking-form-dialog', () => ({ BookingFormDialog: () => null }));
vi.mock('../components/deliver-dialog', () => ({ DeliverDialog: (p: { open: boolean; booking: { id: string } }) => (p.open ? <div data-testid="deliver-dialog" data-booking={p.booking.id} /> : null) }));
vi.mock('../api', () => ({ salesApi: { deliver: h.deliver, generateInvoice: vi.fn(), invoicePdf: h.invoicePdf } }));
vi.mock('@/features/delivery/api', () => ({ deliveryApi: { note: h.note } }));
vi.mock('@/lib/download', () => ({ openBlob: h.openBlob, saveBlob: h.saveBlob, printBlob: h.printBlob }));
vi.mock('../components/vehicle-details-dialog', () => ({ VehicleDetailsDialog: () => null }));
vi.mock('@/features/customers/components/customer-detail-dialog', () => ({ CustomerDetailDialog: () => null }));
vi.mock('@/features/returns/components/create-return-dialog', () => ({ CreateReturnDialog: () => null }));
vi.mock('@/features/returns/components/return-detail-dialog', () => ({ ReturnDetailDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[], over: Record<string, any> = {}): void => {
  cleanup();
  h.perms.current = new Set(perms);
  h.booking.current = makeBooking(over);
  render(<MemoryRouter initialEntries={['/bookings/b1']}><Routes><Route path="/bookings/:id" element={<BookingDetailPage />} /></Routes></MemoryRouter>);
};
const q = {
  payment: () => screen.queryByRole('button', { name: /Take payment/ }),
  finance: () => screen.queryByRole('button', { name: 'Finance' }),
  insurance: () => screen.queryByRole('button', { name: 'Insurance' }),
  schedule: () => screen.queryByRole('button', { name: 'Schedule' }),
  invoice: () => screen.queryByRole('button', { name: /Generate invoice/ }),
  cancel: () => screen.queryByRole('button', { name: 'Cancel' }),
  edit: () => screen.queryByRole('button', { name: 'Edit' }),
  vehicle: () => screen.queryByRole('button', { name: /View vehicle details/ }),
};
beforeEach(() => { h.perms.current = new Set(); h.booking.current = makeBooking(); });

describe('BookingDetailPage permission gating (each action independent)', () => {
  it('view-only: no mutation controls, but vehicle details is always available', () => {
    renderWith(['bookings.view']);
    expect(q.payment()).toBeNull();
    expect(q.finance()).toBeNull();
    expect(q.insurance()).toBeNull();
    expect(q.schedule()).toBeNull();
    expect(q.invoice()).toBeNull();
    expect(q.cancel()).toBeNull();
    expect(q.edit()).toBeNull();
    expect(q.vehicle()).not.toBeNull();
  });
  it('bookings.payment → Take payment only', () => {
    renderWith(['bookings.view', 'bookings.payment']);
    expect(q.payment()).not.toBeNull();
    expect(q.finance()).toBeNull();
    expect(q.cancel()).toBeNull();
  });
  it('bookings.update → Edit + Finance/Insurance/Schedule (not payment/invoice/cancel)', () => {
    renderWith(['bookings.view', 'bookings.update']);
    expect(q.edit()).not.toBeNull();
    expect(q.finance()).not.toBeNull();
    expect(q.insurance()).not.toBeNull();
    expect(q.schedule()).not.toBeNull();
    expect(q.payment()).toBeNull();
    expect(q.invoice()).toBeNull();
    expect(q.cancel()).toBeNull();
  });
  it('bookings.invoice → Generate invoice only', () => {
    renderWith(['bookings.view', 'bookings.invoice']);
    expect(q.invoice()).not.toBeNull();
    expect(q.finance()).toBeNull();
  });
  it('bookings.cancel → Cancel only', () => {
    renderWith(['bookings.view', 'bookings.cancel']);
    expect(q.cancel()).not.toBeNull();
    expect(q.finance()).toBeNull();
  });
});

describe('BookingDetailPage lifecycle (converted immutable / cancelled)', () => {
  it('a CONVERTED booking is immutable — no Edit, no Cancel even with permissions', () => {
    renderWith(['bookings.view', 'bookings.update', 'bookings.cancel'], { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'INVOICED', invoicedAt: null } });
    expect(q.edit()).toBeNull();
    expect(q.cancel()).toBeNull();
  });
  it('a CONVERTED-but-undelivered booking shows the Pending Delivery badge (distinct from booking status)', () => {
    renderWith(['bookings.view'], { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'INVOICED', invoicedAt: null } });
    expect(screen.getByText('Pending Delivery')).toBeInTheDocument();
  });
  it('a delivered booking shows the Delivered badge', () => {
    renderWith(['bookings.view'], { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'DELIVERED', invoicedAt: null }, actualDelivery: '2026-02-01T00:00:00.000Z' });
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });
  it('an active booking shows the normal Paid / Balance breakup', () => {
    renderWith(['bookings.view']); // CONFIRMED, paid 500 / balance 500
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Balance')).toBeInTheDocument();
  });

  it('a cancelled, paid booking shows no active Pending balance; the advance is retained (not refunded)', () => {
    renderWith(['bookings.view'], { status: 'CANCELLED', paymentSummary: { status: 'PARTIAL', paid: '500', balance: '500' }, payments: [] });
    // The pre-cancellation shortfall is never presented as a Balance/Pending amount owed.
    expect(screen.queryByText('Balance')).toBeNull();
    // Amount received is labelled "Received"; the retained advance is called out.
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getAllByText(/retained \(not refunded\)/i).length).toBeGreaterThan(0);
  });
});

describe('BookingDetailPage — Deliver asks for the delivery date', () => {
  const invoiced = { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV-1', status: 'INVOICED', invoicedAt: null } };
  const deliverBtn = () => screen.queryByRole('button', { name: 'Deliver' });

  it('Deliver opens the delivery-date dialog instead of delivering straight away', () => {
    h.deliver.mockReset();
    renderWith(['bookings.view', 'bookings.update'], invoiced);
    expect(screen.queryByTestId('deliver-dialog')).toBeNull();
    fireEvent.click(deliverBtn()!);
    expect(screen.getByTestId('deliver-dialog')).toHaveAttribute('data-booking', 'b1');
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('Deliver still needs bookings.update, an invoice, and an undelivered vehicle', () => {
    renderWith(['bookings.view'], invoiced);
    expect(deliverBtn()).toBeNull();
    renderWith(['bookings.view', 'bookings.update']);
    expect(deliverBtn()).toBeNull(); // no invoice yet
    renderWith(['bookings.view', 'bookings.update'], { ...invoiced, actualDelivery: '2026-10-04T06:30:00.000Z' });
    expect(deliverBtn()).toBeNull();
  });

  it('shows the recorded delivery date once delivered', () => {
    renderWith(['bookings.view'], { ...invoiced, sale: { ...invoiced.sale, status: 'DELIVERED' }, actualDelivery: '2026-10-04T06:30:00.000Z' });
    const shown = new Date('2026-10-04T06:30:00.000Z').toLocaleDateString('en-IN');
    expect(screen.getByText(`Actual: ${shown}`)).toBeInTheDocument();
    expect(screen.getByText(`Delivered ${shown}`)).toBeInTheDocument();
  });
});

describe('BookingDetailPage — documents', () => {
  const pdf = new Blob(['%PDF-'], { type: 'application/pdf' });
  const invoiced = { status: 'CONVERTED', sale: { id: 's1', invoiceNumber: 'INV/0007', status: 'INVOICED', invoicedAt: null } };
  const deliveredBooking = { ...invoiced, sale: { ...invoiced.sale, status: 'DELIVERED' }, actualDelivery: '2026-10-04T06:30:00.000Z' };
  const buttons = (name: RegExp) => screen.getAllByRole('button', { name });

  it('View / Download / Print still work and use the existing invoice endpoint and filename', async () => {
    h.invoicePdf.mockReset().mockResolvedValue(pdf);
    h.openBlob.mockReset(); h.saveBlob.mockReset(); h.printBlob.mockReset();
    renderWith(['bookings.view'], invoiced);
    fireEvent.click(buttons(/^View invoice$/)[0]!);
    await waitFor(() => expect(h.openBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
    fireEvent.click(buttons(/^Download PDF$/)[0]!);
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
    fireEvent.click(buttons(/^Print$/)[0]!);
    await waitFor(() => expect(h.printBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
    expect(h.invoicePdf).toHaveBeenCalledWith('b1');
    expect(h.invoicePdf).toHaveBeenCalledTimes(3);
  });

  it('the invoice is offered in the header and in the invoice card — both through the shared component', () => {
    renderWith(['bookings.view'], invoiced);
    expect(buttons(/^View invoice$/)).toHaveLength(2);
    expect(buttons(/^Download PDF$/)).toHaveLength(2);
    expect(buttons(/^Print$/)).toHaveLength(2);
  });

  it('the delivery note appears only after delivery, and only with delivery.view', () => {
    renderWith(['bookings.view', 'delivery.view'], invoiced);
    expect(screen.queryByRole('button', { name: /^Delivery note PDF$/ })).toBeNull();
    renderWith(['bookings.view'], deliveredBooking);
    expect(screen.queryByRole('button', { name: /^Delivery note PDF$/ })).toBeNull();
    renderWith(['bookings.view', 'delivery.view'], deliveredBooking);
    expect(buttons(/^Delivery note PDF$/).length).toBeGreaterThanOrEqual(1);
    expect(buttons(/^View invoice$/).length).toBeGreaterThanOrEqual(1);
  });

  it('no sale → no invoice or delivery note actions', () => {
    renderWith(['bookings.view', 'delivery.view']);
    expect(screen.queryByRole('button', { name: /^View invoice$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delivery note PDF$/ })).toBeNull();
  });
});
