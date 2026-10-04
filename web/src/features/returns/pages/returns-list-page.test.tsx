import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleReturnDto } from '@azad/shared';
import { ReturnsListPage } from './returns-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }), useCan: (p: string) => h.perms.current.has(p) }));

const row = { id: 'r1', returnNumber: 'RET-1', customerName: 'Asha', vin: 'V1', bookingCode: 'BK-1', requestedAt: new Date().toISOString(), saleTotal: '1000', status: 'REQUESTED' } as unknown as VehicleReturnDto;
vi.mock('../hooks', () => ({
  // Mirror the real hook: data only when enabled (returns.view).
  useReturns: (_q: unknown, enabled: boolean) => ({ data: enabled ? { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : undefined, isLoading: false, isFetching: false }),
}));
vi.mock('../components/return-detail-dialog', () => ({ ReturnDetailDialog: () => null }));
vi.mock('../components/create-return-dialog', () => ({ CreateReturnDialog: () => null }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><ReturnsListPage /></MemoryRouter>); };
const q = {
  row: () => screen.queryByText('RET-1'),
  request: () => screen.queryByRole('button', { name: /Request return/ }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('ReturnsListPage permission gating', () => {
  it('returns.view: reads the list, no Request return', () => {
    renderWith(['returns.view']);
    expect(q.row()).not.toBeNull();
    expect(q.request()).toBeNull();
  });

  it('returns.create → Request return button', () => {
    renderWith(['returns.view', 'returns.create']);
    expect(q.request()).not.toBeNull();
  });

  it('no returns.view → list query disabled, no rows', () => {
    renderWith([]);
    expect(q.row()).toBeNull();
    expect(q.request()).toBeNull();
  });
});
