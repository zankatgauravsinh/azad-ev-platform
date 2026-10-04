import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeliveryDetailDialog } from './delivery-detail-dialog';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const data = {
  booking: {
    bookingId: 'b1', code: 'BK-1', status: 'SCHEDULED', customerName: 'Asha', customerPhone: '98',
    model: 'VX', variant: 'Pro', vin: 'V1', invoiceNumber: 'INV-1', balance: 0n, salesExecutive: 'Tej',
    actualDelivery: null, pendingDocuments: null,
  },
  delivery: null, // not yet delivered → schedule + complete controls render
};
const stub = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
vi.mock('../hooks', () => ({
  useDelivery: () => ({ data }),
  useDeliveryMutations: () => ({ schedule: stub, complete: stub, checklist: stub, addPhoto: stub, removePhoto: stub, setSignature: stub }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  render(<DeliveryDetailDialog id="b1" onOpenChange={() => {}} />);
};
const saveBtn = () => screen.queryByRole('button', { name: /^Save$/ });
const completeBtn = () => screen.queryByRole('button', { name: /Complete delivery/ });
beforeEach(() => { h.perms.current = new Set(); });

describe('DeliveryDetailDialog permission gating', () => {
  it('delivery.view only → read the record, but no manage controls', () => {
    renderWith([]); // reached the dialog via delivery.view nav; no manage permission
    expect(screen.getByText('Asha')).toBeInTheDocument(); // readable
    expect(saveBtn()).toBeNull();
    expect(completeBtn()).toBeNull();
  });

  it('delivery.manage → scheduling and completion controls appear', () => {
    renderWith(['delivery.manage']);
    expect(saveBtn()).not.toBeNull();
    expect(completeBtn()).not.toBeNull();
  });
});
