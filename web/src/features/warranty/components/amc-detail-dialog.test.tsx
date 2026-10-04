import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AmcDetailDialog } from './amc-detail-dialog';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const amc = {
  id: 'a1', amcNumber: 'AMC-1', status: 'ACTIVE', planType: 'BASIC', daysToExpiry: 100, customerName: 'Asha',
  model: 'VX', vin: 'V1', startDate: '2026-01-01', endDate: '2027-01-01', price: 1000n,
  visitsUsed: 0, visitsIncluded: 4, visitsRemaining: 4, visits: [],
};
const stub = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('../hooks', () => ({ useAmcPlan: () => ({ data: amc }), useWarrantyMutations: () => ({ recordVisit: stub }) }));
vi.mock('../api', () => ({ amcApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<AmcDetailDialog id="a1" onOpenChange={() => {}} />); };
const addVisit = () => screen.queryByRole('button', { name: /Add visit/ });
const recordHeading = () => screen.queryByText('Record a visit');
beforeEach(() => { h.perms.current = new Set(); });

describe('AmcDetailDialog permission gating (amc.manage)', () => {
  it('amc.view only: readable, no record-visit controls', () => {
    renderWith(['amc.view']);
    expect(screen.getByText('AMC-1')).toBeInTheDocument();
    expect(recordHeading()).toBeNull();
    expect(addVisit()).toBeNull();
  });

  it('amc.manage: record-visit section appears', () => {
    renderWith(['amc.view', 'amc.manage']);
    expect(recordHeading()).not.toBeNull();
    expect(addVisit()).not.toBeNull();
  });
});
