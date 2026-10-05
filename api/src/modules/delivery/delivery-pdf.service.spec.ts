import { deliveryNoteDate } from './delivery-pdf.service';

describe('deliveryNoteDate', () => {
  it('prints the date in the company time zone, not the server\'s', () => {
    // 19:00 UTC on 4 October is already the 5th in India.
    expect(deliveryNoteDate('2026-10-04T19:00:00.000Z', 'Asia/Kolkata')).toBe('5/10/2026');
    expect(deliveryNoteDate('2026-10-04T19:00:00.000Z', 'UTC')).toBe('4/10/2026');
    expect(deliveryNoteDate('2026-10-04T19:00:00.000Z', 'America/New_York')).toBe('4/10/2026');
  });

  it('prints a back-dated delivery (stored at company noon) as the chosen date', () => {
    expect(deliveryNoteDate('2026-10-04T06:30:00.000Z', 'Asia/Kolkata')).toBe('4/10/2026');
    expect(deliveryNoteDate('2026-02-28T22:00:00.000Z', 'Pacific/Kiritimati')).toBe('1/3/2026');
  });
});
