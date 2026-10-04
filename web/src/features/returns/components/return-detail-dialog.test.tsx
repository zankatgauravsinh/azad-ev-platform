import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, type Mock } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role, type ReturnStatus, type VehicleReturnDto } from '@azad/shared';
import { ReturnDetailDialog } from './return-detail-dialog';
import { useReturn } from '../hooks';
import { useAuth } from '@/features/auth/auth-context';

vi.mock('../hooks', () => ({
  useReturn: vi.fn(),
  useReturnMutations: () => ({
    inspect: { mutateAsync: vi.fn(), isPending: false },
    approve: { mutateAsync: vi.fn(), isPending: false },
    reject: { mutateAsync: vi.fn(), isPending: false },
    cancel: { mutateAsync: vi.fn(), isPending: false },
    complete: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: vi.fn() }));

const sample = (status: ReturnStatus): VehicleReturnDto =>
  ({
    id: 'r1', returnNumber: 'RET0001', status, reason: 'Faulty motor',
    saleId: 's1', invoiceNumber: 'INV0001', bookingId: 'b1', bookingCode: 'BK0001',
    unitId: 'u1', vin: 'VIN123', customerId: 'c1', customerName: 'Ramesh',
    saleTotal: '10500000', amountPaid: '1000000',
    requestedById: 'u9', requestedByName: 'Sales Sam', requestedAt: new Date().toISOString(),
    inspectionOk: status === 'REQUESTED' ? null : true, inspectionNotes: null,
    inspectedByName: null, inspectedAt: null, approvedByName: null, approvedAt: null, rejectionReason: null,
    disposition: null, deductionAmount: '0', deductionReason: null, completedAt: null,
    creditNote: null, refunds: [], createdAt: new Date().toISOString(),
  }) as unknown as VehicleReturnDto;

// Permission-driven (Batch 6): the dialog reads can() from effective permissions. Build the set from
// the role's real system permissions so the existing OWNER/SALES expectations hold.
const setup = (status: ReturnStatus, role: string): void => {
  const perms = new Set(SYSTEM_ROLE_PERMISSIONS[role as Role] ?? []);
  (useReturn as unknown as Mock).mockReturnValue({ data: sample(status), isLoading: false, isError: false });
  (useAuth as unknown as Mock).mockReturnValue({ can: (p: string) => perms.has(p) });
  render(<MemoryRouter><ReturnDetailDialog id="r1" onOpenChange={() => {}} /></MemoryRouter>);
};

const has = (name: RegExp): boolean => screen.queryByRole('button', { name }) !== null;

describe('ReturnDetailDialog — state- and role-aware actions', () => {
  it('renders the approval trail', () => {
    setup('REQUESTED', 'OWNER');
    expect(screen.getByText('RET0001')).toBeInTheDocument();
    expect(screen.getByText('Requested by')).toBeInTheDocument();
    expect(screen.getByText('Sales Sam')).toBeInTheDocument();
  });

  it('REQUESTED (manager): inspect / reject / cancel; no approve or complete', () => {
    setup('REQUESTED', 'OWNER');
    expect(has(/record inspection/i)).toBe(true);
    expect(has(/reject/i)).toBe(true);
    expect(has(/^cancel$/i)).toBe(true);
    expect(has(/^approve$/i)).toBe(false);
    expect(has(/complete return/i)).toBe(false);
  });

  it('INSPECTION (manager): approve appears, inspection is done', () => {
    setup('INSPECTION', 'OWNER');
    expect(has(/^approve$/i)).toBe(true);
    expect(has(/record inspection/i)).toBe(false);
  });

  it('APPROVED (manager): complete appears', () => {
    setup('APPROVED', 'OWNER');
    expect(has(/complete return/i)).toBe(true);
  });

  it('SALES role sees no management actions (server remains authoritative)', () => {
    setup('REQUESTED', 'SALES_EXECUTIVE');
    expect(has(/record inspection/i)).toBe(false);
    expect(has(/reject/i)).toBe(false);
    expect(has(/complete return/i)).toBe(false);
    expect(has(/open customer/i)).toBe(true); // navigation still available
  });
});

// Each return permission gates its own action, independently of the others.
describe('ReturnDetailDialog per-permission independence (custom roles)', () => {
  const renderPerms = (status: ReturnStatus, perms: string[]): void => {
    cleanup();
    (useReturn as unknown as Mock).mockReturnValue({ data: sample(status), isLoading: false, isError: false });
    (useAuth as unknown as Mock).mockReturnValue({ can: (p: string) => perms.includes(p) });
    render(<MemoryRouter><ReturnDetailDialog id="r1" onOpenChange={() => {}} /></MemoryRouter>);
  };

  it('view-only: no management actions in any state', () => {
    renderPerms('REQUESTED', ['returns.view']);
    expect(has(/record inspection/i)).toBe(false);
    expect(has(/reject/i)).toBe(false);
    expect(has(/^cancel$/i)).toBe(false);
  });

  it('returns.inspect → Record inspection only (not reject/cancel)', () => {
    renderPerms('REQUESTED', ['returns.view', 'returns.inspect']);
    expect(has(/record inspection/i)).toBe(true);
    expect(has(/reject/i)).toBe(false);
    expect(has(/^cancel$/i)).toBe(false);
  });

  it('returns.approve → Approve only (INSPECTION state), does not imply complete', () => {
    renderPerms('INSPECTION', ['returns.view', 'returns.approve']);
    expect(has(/^approve$/i)).toBe(true);
    expect(has(/record inspection/i)).toBe(false);
    expect(has(/^cancel$/i)).toBe(false);
  });

  it('returns.complete → Complete only (APPROVED state), does not imply approve', () => {
    renderPerms('APPROVED', ['returns.view', 'returns.complete']);
    expect(has(/complete return/i)).toBe(true);
    expect(has(/^cancel$/i)).toBe(false);
  });

  it('returns.reject → Reject only (not inspect/cancel)', () => {
    renderPerms('REQUESTED', ['returns.view', 'returns.reject']);
    expect(has(/reject/i)).toBe(true);
    expect(has(/record inspection/i)).toBe(false);
    expect(has(/^cancel$/i)).toBe(false);
  });

  it('returns.cancel → Cancel only (not inspect/reject)', () => {
    renderPerms('REQUESTED', ['returns.view', 'returns.cancel']);
    expect(has(/^cancel$/i)).toBe(true);
    expect(has(/record inspection/i)).toBe(false);
    expect(has(/reject/i)).toBe(false);
  });
});
