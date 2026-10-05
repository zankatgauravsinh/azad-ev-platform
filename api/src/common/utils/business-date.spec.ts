import { DEFAULT_BUSINESS_TIME_ZONE, businessDateOf, noonOf, resolveTimeZone } from './business-date';

const at = (iso: string): Date => new Date(iso);

describe('businessDateOf', () => {
  it('is the calendar date in the given time zone, not in UTC', () => {
    // 19:00 UTC on 30 June is already 00:30 on 1 July in India.
    expect(businessDateOf(at('2026-06-30T19:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-07-01');
    expect(businessDateOf(at('2026-06-30T19:00:00.000Z'), 'UTC')).toBe('2026-06-30');
    expect(businessDateOf(at('2026-06-30T18:29:59.000Z'), 'Asia/Kolkata')).toBe('2026-06-30');
    expect(businessDateOf(at('2026-06-30T18:30:00.000Z'), 'Asia/Kolkata')).toBe('2026-07-01');
  });

  it('handles zones behind UTC and midnight exactly', () => {
    expect(businessDateOf(at('2026-01-01T03:00:00.000Z'), 'America/New_York')).toBe('2025-12-31');
    expect(businessDateOf(at('2026-01-01T00:00:00.000Z'), 'UTC')).toBe('2026-01-01');
    expect(businessDateOf(at('2026-03-01T00:00:00.000Z'), 'Pacific/Kiritimati')).toBe('2026-03-01'); // UTC+14 → 14:00 same day
    expect(businessDateOf(at('2026-03-01T10:00:00.000Z'), 'Pacific/Kiritimati')).toBe('2026-03-02');
  });
});

describe('noonOf', () => {
  it('is 12:00 in the company time zone', () => {
    expect(noonOf('2026-10-04', 'Asia/Kolkata').toISOString()).toBe('2026-10-04T06:30:00.000Z');
    expect(noonOf('2026-10-04', 'UTC').toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(noonOf('2026-03-01', 'Pacific/Kiritimati').toISOString()).toBe('2026-02-28T22:00:00.000Z');
    expect(noonOf('2026-03-01', 'Pacific/Pago_Pago').toISOString()).toBe('2026-03-01T23:00:00.000Z'); // UTC−11
  });

  it('follows daylight saving', () => {
    expect(noonOf('2026-01-15', 'America/New_York').toISOString()).toBe('2026-01-15T17:00:00.000Z'); // EST
    expect(noonOf('2026-07-04', 'America/New_York').toISOString()).toBe('2026-07-04T16:00:00.000Z'); // EDT
    expect(noonOf('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T16:00:00.000Z'); // the day clocks go forward
    expect(noonOf('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T17:00:00.000Z'); // the day clocks go back
  });

  it('always lands on the date it was asked for, in that zone', () => {
    const zones = ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu'];
    const days = ['2024-02-29', '2025-12-31', '2026-01-01', '2026-03-08', '2026-03-29', '2026-10-04', '2026-11-01'];
    for (const zone of zones) for (const day of days) expect([zone, businessDateOf(noonOf(day, zone), zone)]).toEqual([zone, day]);
  });

  it('for India, reads as the same date on a UTC server too', () => {
    for (const day of ['2026-01-01', '2026-06-30', '2026-12-31']) expect(noonOf(day, 'Asia/Kolkata').toISOString().slice(0, 10)).toBe(day);
  });
});

describe('resolveTimeZone', () => {
  it('keeps a zone the runtime knows', () => {
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimeZone(' America/New_York ')).toBe('America/New_York');
    expect(resolveTimeZone('UTC')).toBe('UTC');
  });

  it('falls back to the default for a missing or unusable zone', () => {
    expect(DEFAULT_BUSINESS_TIME_ZONE).toBe('Asia/Kolkata');
    for (const bad of [null, undefined, '', '   ', 'Not/AZone', 'IST+5:30']) expect(resolveTimeZone(bad)).toBe('Asia/Kolkata');
  });
});
