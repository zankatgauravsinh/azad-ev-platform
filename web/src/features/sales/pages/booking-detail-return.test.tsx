import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingDetailPage } from './booking-detail-page';

// Batch 6: the booking-detail "Request return" button (deferred in Batch 2) gates on returns.create.
const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

// A delivered booking (has sale + actualDelivery) → Request return is state-eligible.
const booking = {
  id: 'b1', code: 'BK-1', status: 'CONFIRMED',
  paymentSummary: { status: 'PAID', paid: 1000n, balance: 0n },
  unit: { vin: 'V1', variant: { name: 'Pro', colour: 'Red', model: { name: 'VX' } } },
  exShowroom: 1000n, discount: 0n, exchangeValue: 0n, accessoriesTotal: 0n, rto: 0n, insuranceCharge: 0n, registration: 0n, extendedWarranty: 0n,
  total: 1000n, payments: [], customer: { id: 'c1', name: 'Asha', phone: '98' },
  expectedDelivery: null, actualDelivery: new Date().toISOString(),
  sale: { id: 's1', invoiceNumber: 'INV-1' }, finance: null, insurance: null, pendingDocuments: null,
};
vi.mock('../hooks', () => ({ useBooking: () => ({ data: booking, isLoading: false }), useSalesInvalidate: () => () => {} }));
vi.mock('../components/booking-dialogs', () => ({ PaymentDialog: () => null, FinanceDialog: () => null, InsuranceDialog: () => null, ScheduleDeliveryDialog: () => null, CancelBookingDialog: () => null }));
vi.mock('../components/booking-form-dialog', () => ({ BookingFormDialog: () => null }));
vi.mock('../components/vehicle-details-dialog', () => ({ VehicleDetailsDialog: () => null }));
vi.mock('@/features/customers/components/customer-detail-dialog', () => ({ CustomerDetailDialog: () => null }));
vi.mock('@/features/returns/components/create-return-dialog', () => ({ CreateReturnDialog: () => null }));
vi.mock('@/features/returns/components/return-detail-dialog', () => ({ ReturnDetailDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  render(<MemoryRouter initialEntries={['/bookings/b1']}><Routes><Route path="/bookings/:id" element={<BookingDetailPage />} /></Routes></MemoryRouter>);
};
const requestReturn = () => screen.queryByRole('button', { name: /Request return/ });
beforeEach(() => { h.perms.current = new Set(); });

describe('BookingDetailPage — Request return gating (returns.create)', () => {
  it('returns.create → Request return button visible', () => {
    renderWith(['bookings.view', 'returns.create']);
    expect(requestReturn()).not.toBeNull();
  });

  it('without returns.create → Request return hidden (even for a delivered booking)', () => {
    renderWith(['bookings.view']);
    expect(requestReturn()).toBeNull();
  });
});
