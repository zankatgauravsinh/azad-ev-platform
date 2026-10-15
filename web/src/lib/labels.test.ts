import { describe, it, expect } from 'vitest';
import { paymentContextLabel, titleCase } from './labels';

describe('titleCase', () => {
  it('turns enum codes into words', () => {
    expect(titleCase('STATUS_CHANGE')).toBe('Status Change');
    expect(titleCase('WAITING_FOR_PARTS')).toBe('Waiting For Parts');
  });
  it('keeps acronyms upper-case', () => {
    expect(titleCase('UPI')).toBe('UPI');
    expect(titleCase('NEFT')).toBe('NEFT');
    expect(titleCase('GST_INVOICE')).toBe('GST Invoice');
  });
});

describe('paymentContextLabel', () => {
  it('calls every payment against a booking a booking payment, not an advance', () => {
    expect(paymentContextLabel('BOOKING_ADVANCE')).toBe('Booking payment');
    expect(paymentContextLabel('SERVICE')).toBe('Service payment');
  });
});
