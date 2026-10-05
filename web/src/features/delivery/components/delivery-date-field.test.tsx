import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DeliveryDateField, deliveryDateError, todayDateInput } from './delivery-date-field';

afterEach(cleanup);
const field = (): HTMLInputElement => screen.getByLabelText('Delivery date') as HTMLInputElement;
const shift = (days: number): string => todayDateInput(new Date(Date.now() + days * 86_400_000));

describe('todayDateInput', () => {
  it("is this device's calendar date, not UTC's", () => {
    // Local midnight-ish instants: built from local parts, so the expectation holds in any time zone.
    expect(todayDateInput(new Date(2026, 9, 5, 0, 5))).toBe('2026-10-05');
    expect(todayDateInput(new Date(2026, 9, 5, 23, 55))).toBe('2026-10-05');
    expect(todayDateInput(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('deliveryDateError', () => {
  const now = new Date(2026, 9, 5, 10, 15);
  it('accepts today and any past date', () => {
    expect(deliveryDateError('2026-10-05', now)).toBeNull();
    expect(deliveryDateError('2026-10-04', now)).toBeNull();
    expect(deliveryDateError('2019-01-01', now)).toBeNull();
  });
  it('refuses a future or missing date', () => {
    expect(deliveryDateError('2026-10-06', now)).toBe('Delivery date cannot be in the future');
    expect(deliveryDateError('2027-01-01', now)).toBe('Delivery date cannot be in the future');
    expect(deliveryDateError('', now)).toBe('Choose the delivery date');
  });
});

describe('DeliveryDateField', () => {
  it('is a date input capped at today', () => {
    render(<DeliveryDateField value={todayDateInput()} onChange={() => {}} />);
    expect(field().type).toBe('date');
    expect(field().value).toBe(todayDateInput());
    expect(field().max).toBe(todayDateInput());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the date the user picks', () => {
    const onChange = vi.fn();
    render(<DeliveryDateField value={todayDateInput()} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: shift(-3) } });
    expect(onChange).toHaveBeenCalledWith(shift(-3));
  });

  it('warns about a future date and about an empty one', () => {
    render(<DeliveryDateField value={shift(2)} onChange={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery date cannot be in the future');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    cleanup();
    render(<DeliveryDateField value="" onChange={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the delivery date');
  });

  it('can be shown read-only', () => {
    render(<DeliveryDateField value={todayDateInput()} onChange={() => {}} disabled />);
    expect(field()).toBeDisabled();
  });
});
