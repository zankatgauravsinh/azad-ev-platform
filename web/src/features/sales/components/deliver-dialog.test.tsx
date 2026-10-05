import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { DeliverDialog } from './deliver-dialog';

const h = vi.hoisted(() => ({ deliver: vi.fn(), invalidate: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('../api', () => ({ salesApi: { deliver: h.deliver } }));
vi.mock('../hooks', () => ({ useSalesInvalidate: () => h.invalidate }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const booking = { id: 'b1', code: 'BK-1' };
const shift = (days: number): string => todayDateInput(new Date(Date.now() + days * 86_400_000));
const field = (): HTMLInputElement => screen.getByLabelText('Delivery date') as HTMLInputElement;
const confirm = (): HTMLElement => screen.getByRole('button', { name: /Confirm delivery/ });

beforeEach(() => { h.deliver.mockReset().mockResolvedValue({}); h.invalidate.mockReset(); h.toastSuccess.mockReset(); h.toastError.mockReset(); });
afterEach(cleanup);

describe('DeliverDialog (Booking → Deliver)', () => {
  it('asks for the delivery date, defaulting to today', () => {
    render(<DeliverDialog open onOpenChange={() => {}} booking={booking} />);
    expect(screen.getByText('BK-1')).toBeInTheDocument();
    expect(field().value).toBe(todayDateInput());
    expect(confirm()).not.toBeDisabled();
    expect(h.deliver).not.toHaveBeenCalled(); // opening the dialog delivers nothing
  });

  it('sends today as the delivery date and closes', async () => {
    const onOpenChange = vi.fn();
    render(<DeliverDialog open onOpenChange={onOpenChange} booking={booking} />);
    fireEvent.click(confirm());
    await waitFor(() => expect(h.deliver).toHaveBeenCalledWith('b1', { actualDelivery: todayDateInput() }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.invalidate).toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('Delivered');
  });

  it('sends a past date the user picks', async () => {
    render(<DeliverDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(field(), { target: { value: shift(-5) } });
    fireEvent.click(confirm());
    await waitFor(() => expect(h.deliver).toHaveBeenCalledWith('b1', { actualDelivery: shift(-5) }));
  });

  it('prevents a future or empty date from being submitted', () => {
    render(<DeliverDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(field(), { target: { value: shift(1) } });
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery date cannot be in the future');
    expect(confirm()).toBeDisabled();
    fireEvent.change(field(), { target: { value: '' } });
    expect(confirm()).toBeDisabled();
    fireEvent.click(confirm());
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('shows the server refusal and stays open', async () => {
    h.deliver.mockRejectedValueOnce(new Error('Delivery date cannot be in the future'));
    const onOpenChange = vi.fn();
    render(<DeliverDialog open onOpenChange={onOpenChange} booking={booking} />);
    fireEvent.click(confirm());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(h.invalidate).not.toHaveBeenCalled();
  });

  it('starts from today again each time it is opened', () => {
    const { rerender } = render(<DeliverDialog open onOpenChange={() => {}} booking={booking} />);
    fireEvent.change(field(), { target: { value: shift(-9) } });
    rerender(<DeliverDialog open={false} onOpenChange={() => {}} booking={booking} />);
    rerender(<DeliverDialog open onOpenChange={() => {}} booking={booking} />);
    expect(field().value).toBe(todayDateInput());
  });
});
