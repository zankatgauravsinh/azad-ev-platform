import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingDetailPage } from './booking-detail-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

// Active booking, partially paid, no invoice yet → all action buttons are state-eligible.
const booking = {
  id: 'b1', code: 'BK-1', status: 'CONFIRMED',
  paymentSummary: { status: 'PARTIAL', paid: 500n, balance: 500n },
  unit: { vin: 'V1', variant: { name: 'Pro', colour: 'Red', model: { name: 'VX' } } },
  exShowroom: 1000n, discount: 0n, exchangeValue: 0n, accessoriesTotal: 0n, rto: 0n, insuranceCharge: 0n, registration: 0n, extendedWarranty: 0n,
  total: 1000n, payments: [], customer: { id: 'c1', name: 'Asha', phone: '98' },
  expectedDelivery: null, actualDelivery: null, sale: null, finance: null, insurance: null, pendingDocuments: null,
};
vi.mock('../hooks', () => ({ useBooking: () => ({ data: booking, isLoading: false }), useSalesInvalidate: () => () => {} }));
vi.mock('../components/booking-dialogs', () => ({ PaymentDialog: () => null, FinanceDialog: () => null, InsuranceDialog: () => null, ScheduleDeliveryDialog: () => null }));
vi.mock('@/features/customers/components/customer-detail-dialog', () => ({ CustomerDetailDialog: () => null }));
vi.mock('@/features/returns/components/create-return-dialog', () => ({ CreateReturnDialog: () => null }));
vi.mock('@/features/returns/components/return-detail-dialog', () => ({ ReturnDetailDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  render(<MemoryRouter initialEntries={['/bookings/b1']}><Routes><Route path="/bookings/:id" element={<BookingDetailPage />} /></Routes></MemoryRouter>);
};
const q = {
  payment: () => screen.queryByRole('button', { name: /Take payment/ }),
  finance: () => screen.queryByRole('button', { name: 'Finance' }),
  insurance: () => screen.queryByRole('button', { name: 'Insurance' }),
  schedule: () => screen.queryByRole('button', { name: 'Schedule' }),
  invoice: () => screen.queryByRole('button', { name: /Generate invoice/ }),
  cancel: () => screen.queryByRole('button', { name: 'Cancel' }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('BookingDetailPage permission gating (each action independent)', () => {
  it('view-only: no mutation controls', () => {
    renderWith(['bookings.view']);
    expect(q.payment()).toBeNull();
    expect(q.finance()).toBeNull();
    expect(q.insurance()).toBeNull();
    expect(q.schedule()).toBeNull();
    expect(q.invoice()).toBeNull();
    expect(q.cancel()).toBeNull();
  });
  it('bookings.payment → Take payment only', () => {
    renderWith(['bookings.view', 'bookings.payment']);
    expect(q.payment()).not.toBeNull();
    expect(q.finance()).toBeNull();
    expect(q.cancel()).toBeNull();
  });
  it('bookings.update → Finance/Insurance/Schedule (not payment/invoice/cancel)', () => {
    renderWith(['bookings.view', 'bookings.update']);
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
