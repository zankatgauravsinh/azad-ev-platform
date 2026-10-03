import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BookingsListPage } from './bookings-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const row = { id: 'b1', code: 'BK-1', customer: { name: 'Asha', phone: '98' }, unit: { vin: 'V1', variant: { name: 'Pro', model: { name: 'VX' } } }, total: 1000n, paymentSummary: { status: 'PARTIAL' }, status: 'CONFIRMED', expectedDelivery: null };
vi.mock('../hooks', () => ({ useBookings: () => ({ data: { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isLoading: false, isFetching: false }) }));
vi.mock('../components/booking-form-dialog', () => ({ BookingFormDialog: () => null }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><BookingsListPage /></MemoryRouter>); };
const newBtn = () => screen.queryByRole('button', { name: /New booking/ });
beforeEach(() => { h.perms.current = new Set(); });

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
