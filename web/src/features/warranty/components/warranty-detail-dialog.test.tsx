import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarrantyDetailDialog } from './warranty-detail-dialog';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const data = {
  warranty: {
    id: 'w1', warrantyNumber: 'WR-1', status: 'ACTIVE', daysToExpiry: 100, customerName: 'Asha',
    model: 'VX', variant: 'Pro', vin: 'V1', motorNumber: 'M1', batteryNumber: 'B1', invoiceNumber: 'INV-1',
    purchaseDate: '2026-01-01', startDate: '2026-01-01', endDate: '2027-01-01',
  },
  coverage: [],
  freeServices: [{ id: 'fs1', serviceNumber: 1, dueDate: '2026-02-01', status: 'PENDING', technicianName: null }],
  claims: [{ id: 'cl1', claimNumber: 'CL-1', complaint: 'Noise', claimCost: 0n, status: 'PENDING' }],
  timeline: [],
};
const stub = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('../hooks', () => ({
  useWarranty: () => ({ data }),
  useWarrantyMutations: () => ({ cancel: stub, completeFreeService: stub, updateClaim: stub }),
}));
vi.mock('./create-claim-dialog', () => ({ CreateClaimDialog: () => null }));
vi.mock('../api', () => ({ warrantyApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<WarrantyDetailDialog id="w1" onOpenChange={() => {}} />); };
const q = {
  newClaim: () => screen.queryByRole('button', { name: /New claim/ }),
  cancel: () => screen.queryByRole('button', { name: /Cancel/ }),
  markDone: () => screen.queryByRole('button', { name: 'Mark done' }),
  approve: () => screen.queryByRole('button', { name: 'Approve' }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('WarrantyDetailDialog permission gating (claims.manage / warranty.update / warranty.cancel independent)', () => {
  it('view-only: readable, no mutation controls', () => {
    renderWith(['warranty.view']);
    expect(screen.getByText('WR-1')).toBeInTheDocument();
    expect(q.newClaim()).toBeNull();
    expect(q.cancel()).toBeNull();
    expect(q.markDone()).toBeNull();
    expect(q.approve()).toBeNull();
  });

  it('claims.manage → New claim + claim Approve (not cancel/free-service)', () => {
    renderWith(['warranty.view', 'claims.manage']);
    expect(q.newClaim()).not.toBeNull();
    expect(q.approve()).not.toBeNull();
    expect(q.cancel()).toBeNull();
    expect(q.markDone()).toBeNull();
  });

  it('warranty.update → free-service Mark done only', () => {
    renderWith(['warranty.view', 'warranty.update']);
    expect(q.markDone()).not.toBeNull();
    expect(q.newClaim()).toBeNull();
    expect(q.approve()).toBeNull();
    expect(q.cancel()).toBeNull();
  });

  it('warranty.cancel → Cancel only', () => {
    renderWith(['warranty.view', 'warranty.cancel']);
    expect(q.cancel()).not.toBeNull();
    expect(q.newClaim()).toBeNull();
    expect(q.markDone()).toBeNull();
  });
});
