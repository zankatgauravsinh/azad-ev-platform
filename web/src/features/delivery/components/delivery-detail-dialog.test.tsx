import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeliveryDetailDialog } from './delivery-detail-dialog';
import { todayDateInput } from './delivery-date-field';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, data: { current: null as any }, complete: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const pending = () => ({
  booking: {
    bookingId: 'b1', code: 'BK-1', status: 'SCHEDULED', customerName: 'Asha', customerPhone: '98',
    model: 'VX', variant: 'Pro', vin: 'V1', invoiceNumber: 'INV-1', balance: 0n, salesExecutive: 'Tej',
    actualDelivery: null, pendingDocuments: null,
  },
  delivery: null, // not yet delivered → schedule + complete controls render
});
const stub = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
vi.mock('../hooks', () => ({
  useDelivery: () => ({ data: h.data.current }),
  useDeliveryMutations: () => ({ schedule: stub, complete: { mutateAsync: h.complete, isPending: false }, checklist: stub, addPhoto: stub, removePhoto: stub, setSignature: stub }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  render(<DeliveryDetailDialog id="b1" onOpenChange={() => {}} />);
};
const saveBtn = () => screen.queryByRole('button', { name: /^Save$/ });
const completeBtn = () => screen.queryByRole('button', { name: /Complete delivery/ });
const dateField = (): HTMLInputElement => screen.getByLabelText('Delivery date') as HTMLInputElement;
const shift = (days: number): string => todayDateInput(new Date(Date.now() + days * 86_400_000));
beforeEach(() => { h.perms.current = new Set(); h.data.current = pending(); h.complete.mockReset().mockResolvedValue({}); });

describe('DeliveryDetailDialog permission gating', () => {
  it('delivery.view only → read the record, but no manage controls', () => {
    renderWith([]); // reached the dialog via delivery.view nav; no manage permission
    expect(screen.getByText('Asha')).toBeInTheDocument(); // readable
    expect(saveBtn()).toBeNull();
    expect(completeBtn()).toBeNull();
    expect(dateField()).toBeDisabled(); // the date is visible but cannot be set
  });

  it('delivery.manage → scheduling and completion controls appear', () => {
    renderWith(['delivery.manage']);
    expect(saveBtn()).not.toBeNull();
    expect(completeBtn()).not.toBeNull();
  });
});

describe('DeliveryDetailDialog delivery date', () => {
  it('the completion flow has a Delivery date field that defaults to today', () => {
    renderWith(['delivery.manage']);
    expect(dateField().type).toBe('date');
    expect(dateField().value).toBe(todayDateInput());
    expect(dateField().max).toBe(todayDateInput());
    expect(dateField()).not.toBeDisabled();
    expect(completeBtn()).not.toBeDisabled();
  });

  it('completing sends the delivery date with the rest of the handover', async () => {
    renderWith(['delivery.manage']);
    fireEvent.click(completeBtn()!);
    await waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    expect(h.complete.mock.calls[0]![0]).toEqual({ id: 'b1', body: { actualDelivery: todayDateInput(), notes: undefined, overrideReason: undefined, checklist: {} } });
  });

  it('the user can change it to a past date, and that date is submitted', async () => {
    renderWith(['delivery.manage']);
    fireEvent.change(dateField(), { target: { value: shift(-4) } });
    expect(dateField().value).toBe(shift(-4));
    fireEvent.click(completeBtn()!);
    await waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    expect(h.complete.mock.calls[0]![0].body.actualDelivery).toBe(shift(-4));
  });

  it('a future date is prevented: warning shown, nothing submitted', () => {
    renderWith(['delivery.manage']);
    fireEvent.change(dateField(), { target: { value: shift(1) } });
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery date cannot be in the future');
    expect(completeBtn()).toBeDisabled();
    fireEvent.click(completeBtn()!);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('after completion the chosen delivery date is shown and the date field is gone', () => {
    h.data.current = {
      booking: { ...pending().booking, status: 'DELIVERED', actualDelivery: '2026-10-04T06:30:00.000Z' },
      delivery: { id: 'd1', deliveredAt: '2026-10-04T06:30:00.000Z', deliveredBy: 'Tej', notes: null, overrideReason: null, signatureUrl: null, googleReviewSent: false, checklist: {}, photos: [] },
    };
    renderWith(['delivery.manage']);
    expect(screen.getByText('Delivered on')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-10-04T06:30:00.000Z').toLocaleDateString('en-IN'))).toBeInTheDocument();
    expect(screen.queryByLabelText('Delivery date')).toBeNull();
    expect(completeBtn()).toBeNull();
  });
});
