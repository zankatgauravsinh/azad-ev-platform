import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarrantyDetailDialog } from './warranty-detail-dialog';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, role: { current: 'MANAGER' } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p), user: { role: h.role.current } }) }));

const data = {
  warranty: {
    id: 'w1', warrantyNumber: 'WR-1', status: 'ACTIVE', daysToExpiry: 100, customerName: 'Asha',
    model: 'VX', variant: 'Pro', vin: 'V1', motorNumber: 'M1', batteryNumber: 'B1', invoiceNumber: 'INV-1',
    purchaseDate: '2026-01-01', startDate: '2026-01-01', endDate: '2029-01-01', periodMonths: 36, controllerNumber: 'CT1', chargerNumber: null,
  },
  coverage: [
    { item: 'MOTOR', label: 'Motor', covered: true, remarks: null, months: 36, validUntil: '2029-01-01T00:00:00.000Z' },
    { item: 'CHARGER', label: 'Charger', covered: false, remarks: null, months: null, validUntil: null },
  ],
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
vi.mock('./warranty-months-dialog', () => ({ WarrantyMonthsDialog: () => null }));
vi.mock('../api', () => ({ warrantyApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[], role = 'MANAGER'): void => { cleanup(); h.perms.current = new Set(perms); h.role.current = role; render(<WarrantyDetailDialog id="w1" onOpenChange={() => {}} />); };
const q = {
  newClaim: () => screen.queryByRole('button', { name: /New claim/ }),
  cancel: () => screen.queryByRole('button', { name: /Cancel/ }),
  markDone: () => screen.queryByRole('button', { name: 'Mark done' }),
  approve: () => screen.queryByRole('button', { name: 'Approve' }),
  editMonths: () => screen.queryByRole('button', { name: /Edit months/ }),
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

describe('WarrantyDetailDialog component months', () => {
  it("shows each component's months and end date", () => {
    renderWith(['warranty.view']);
    expect(screen.getByRole('columnheader', { name: 'Months' })).toBeInTheDocument();
    const cells = (label: string): string[] => within(screen.getByRole('row', { name: new RegExp(`^${label}`) })).getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells('Motor')).toEqual(['Motor', 'Covered', '36', new Date('2029-01-01T00:00:00.000Z').toLocaleDateString('en-IN'), '—']);
    expect(cells('Charger')).toEqual(['Charger', 'Excluded', '—', '—', '—']);
    expect(screen.getByText('CT1')).toBeInTheDocument();
  });

  it('only the owner (with warranty.update) can edit the months', () => {
    renderWith(['warranty.view', 'warranty.update'], 'MANAGER');
    expect(q.editMonths()).toBeNull();
    renderWith(['warranty.view'], 'OWNER');
    expect(q.editMonths()).toBeNull();
    renderWith(['warranty.view', 'warranty.update'], 'OWNER');
    expect(q.editMonths()).not.toBeNull();
  });
});
