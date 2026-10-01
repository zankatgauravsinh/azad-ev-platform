import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, type Mock } from 'vitest';
import type { ReturnStatus, VehicleReturnDto } from '@azad/shared';
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

const setup = (status: ReturnStatus, role: string): void => {
  (useReturn as unknown as Mock).mockReturnValue({ data: sample(status), isLoading: false, isError: false });
  (useAuth as unknown as Mock).mockReturnValue({ user: { role } });
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
