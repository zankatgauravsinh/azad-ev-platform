import { isCalendarDate, periodCovers, periodsOverlap, startOfCalendarDay, toCalendarDate } from './tax-calendar';

describe('tax-calendar (calendar-date semantics, both ends inclusive)', () => {
  it('isCalendarDate accepts only real YYYY-MM-DD dates', () => {
    expect(isCalendarDate('2026-06-30')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true); // leap year
    for (const bad of ['2026-02-30', '2026-13-01', '2026-6-30', '30-06-2026', '2026-06-30T00:00:00.000Z', '', 'today', null, undefined, 20260630, new Date()]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  it('toCalendarDate / startOfCalendarDay drop any time-of-day', () => {
    expect(toCalendarDate(new Date('2026-06-30T00:00:00.000Z'))).toBe('2026-06-30');
    expect(toCalendarDate(new Date('2026-06-30T23:59:59.999Z'))).toBe('2026-06-30');
    expect(startOfCalendarDay(new Date('2026-06-30T17:45:00.000Z')).toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('periodCovers is inclusive on both ends', () => {
    expect(periodCovers('2026-01-01', '2026-06-30', '2026-01-01')).toBe(true); // first day
    expect(periodCovers('2026-01-01', '2026-06-30', '2026-06-30')).toBe(true); // last day
    expect(periodCovers('2026-01-01', '2026-06-30', '2025-12-31')).toBe(false); // day before
    expect(periodCovers('2026-01-01', '2026-06-30', '2026-07-01')).toBe(false); // day after
    expect(periodCovers('2026-07-01', null, '2026-07-01')).toBe(true); // open-ended, first day
    expect(periodCovers('2026-07-01', null, '2099-12-31')).toBe(true);
    expect(periodCovers('2026-07-01', null, '2026-06-30')).toBe(false);
    expect(periodCovers('2026-06-30', '2026-06-30', '2026-06-30')).toBe(true); // single-day period
  });

  it('periodsOverlap: adjacent periods do not overlap, a shared day does', () => {
    expect(periodsOverlap('2026-01-01', '2026-06-30', '2026-07-01', null)).toBe(false); // adjacent
    expect(periodsOverlap('2026-07-01', null, '2026-01-01', '2026-06-30')).toBe(false); // symmetric
    expect(periodsOverlap('2026-01-01', '2026-06-30', '2026-06-30', null)).toBe(true); // share 30 Jun
    expect(periodsOverlap('2026-01-01', '2026-06-30', '2026-06-30', '2026-06-30')).toBe(true); // same-day boundary
    expect(periodsOverlap('2026-01-01', '2026-06-30', '2026-03-01', '2026-04-01')).toBe(true); // contained
    expect(periodsOverlap('2026-01-01', null, '2030-01-01', null)).toBe(true); // two open-ended
    expect(periodsOverlap('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28')).toBe(false);
  });
});
