import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VehicleReturnDto } from '@azad/shared';
import { CompleteReturnDialog } from './complete-return-dialog';

// The dialog must DISPLAY backend figures and never recompute accounting — we only mock the mutation.
const mutateAsync = vi.fn();
vi.mock('../hooks', () => ({ useReturnMutations: () => ({ complete: { mutateAsync, isPending: false } }) }));

const ret = {
  id: 'r1', returnNumber: 'RET0001', status: 'APPROVED',
  saleTotal: '10500000', amountPaid: '1000000', deductionAmount: '0',
  refunds: [], creditNote: null,
} as unknown as VehicleReturnDto;

const complete = (): HTMLElement => screen.getByRole('button', { name: /complete return/i });

describe('CompleteReturnDialog', () => {
  beforeEach(() => mutateAsync.mockReset());

  it('shows the authoritative sale total, amount paid and estimated refund', () => {
    render(<CompleteReturnDialog ret={ret} open onOpenChange={() => {}} />);
    expect(screen.getByText('₹1,05,000')).toBeInTheDocument(); // sale total
    // amount paid + estimated refund (no deduction yet) both ₹10,000
    expect(screen.getAllByText('₹10,000').length).toBeGreaterThanOrEqual(2);
  });

  it('disables completion when the deduction exceeds the amount paid', () => {
    render(<CompleteReturnDialog ret={ret} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '20000' } }); // ₹20,000 > paid ₹10,000
    expect(screen.getByText(/cannot exceed the amount paid/i)).toBeInTheDocument();
    expect(complete()).toBeDisabled();
  });

  it('requires a reason once a deduction is applied, then enables completion', () => {
    render(<CompleteReturnDialog ret={ret} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3000' } }); // ₹3,000 ≤ paid
    expect(complete()).toBeDisabled(); // reason missing
    fireEvent.change(screen.getByPlaceholderText('Required when a deduction is applied'), { target: { value: 'wear and tear' } });
    expect(complete()).not.toBeDisabled();
  });
});
