import { completeDeliverySchema, deliveryDateInputSchema, isCalendarDateString, markDeliveredSchema } from '@azad/shared';
import { FutureDeliveryDateError, resolveDeliveryDate } from './delivery-date';

const IST = 'Asia/Kolkata';
// 10:15 on 5 October 2026 in India.
const NOW = new Date('2026-10-05T04:45:00.000Z');

describe('resolveDeliveryDate', () => {
  it('nothing sent → now, dated today (the behaviour before a date could be chosen)', () => {
    for (const none of [undefined, null]) expect(resolveDeliveryDate(none, NOW, IST)).toEqual({ businessDate: '2026-10-05', deliveredAt: NOW });
  });

  it('today → the current instant, so the real handover time is kept', () => {
    expect(resolveDeliveryDate('2026-10-05', NOW, IST)).toEqual({ businessDate: '2026-10-05', deliveredAt: NOW });
  });

  it('a past date → noon of that date in the company time zone', () => {
    expect(resolveDeliveryDate('2026-10-04', NOW, IST)).toEqual({ businessDate: '2026-10-04', deliveredAt: new Date('2026-10-04T06:30:00.000Z') });
    expect(resolveDeliveryDate('2026-10-04', NOW, 'America/New_York')).toEqual({ businessDate: '2026-10-04', deliveredAt: new Date('2026-10-04T16:00:00.000Z') });
  });

  it('places no limit on how far back the date may be', () => {
    expect(resolveDeliveryDate('2019-01-01', NOW, IST).deliveredAt.toISOString()).toBe('2019-01-01T06:30:00.000Z');
  });

  it('a future date is refused', () => {
    expect(() => resolveDeliveryDate('2026-10-06', NOW, IST)).toThrow(FutureDeliveryDateError);
    expect(() => resolveDeliveryDate('2027-01-01', NOW, IST)).toThrow('Delivery date cannot be in the future');
  });

  it('"today" is the company\'s today, not UTC\'s', () => {
    // 01:00 on 6 October in India is still 5 October in UTC.
    const lateNight = new Date('2026-10-05T19:30:00.000Z');
    expect(resolveDeliveryDate('2026-10-06', lateNight, IST)).toEqual({ businessDate: '2026-10-06', deliveredAt: lateNight });
    expect(() => resolveDeliveryDate('2026-10-06', lateNight, 'UTC')).toThrow(FutureDeliveryDateError);
    // …and yesterday there is the 5th, stored at Indian noon.
    expect(resolveDeliveryDate('2026-10-05', lateNight, IST).deliveredAt.toISOString()).toBe('2026-10-05T06:30:00.000Z');
    // 20:00 on 4 October in New York is already the 5th in UTC: the 5th is still the future there.
    const evening = new Date('2026-10-05T00:00:00.000Z');
    expect(() => resolveDeliveryDate('2026-10-05', evening, 'America/New_York')).toThrow(FutureDeliveryDateError);
    expect(resolveDeliveryDate('2026-10-04', evening, 'America/New_York')).toEqual({ businessDate: '2026-10-04', deliveredAt: evening });
  });

  it('a back-dated delivery is never stored as a future instant', () => {
    const justAfterMidnight = new Date('2026-10-04T18:31:00.000Z'); // 00:01 on the 5th in India
    expect(resolveDeliveryDate('2026-10-04', justAfterMidnight, IST).deliveredAt.getTime()).toBeLessThan(justAfterMidnight.getTime());
  });

  describe('an instant from an older client', () => {
    it('is stored exactly as sent and dated in the company time zone', () => {
      const sent = new Date('2026-10-03T20:00:00.000Z'); // 01:30 on the 4th in India
      expect(resolveDeliveryDate(sent, NOW, IST)).toEqual({ businessDate: '2026-10-04', deliveredAt: sent });
    });

    it('is refused when its date is in the future, accepted later the same day', () => {
      expect(() => resolveDeliveryDate(new Date('2026-10-05T18:30:00.000Z'), NOW, IST)).toThrow(FutureDeliveryDateError); // 00:00 on the 6th
      const tonight = new Date('2026-10-05T18:29:00.000Z'); // 23:59 on the 5th
      expect(resolveDeliveryDate(tonight, NOW, IST)).toEqual({ businessDate: '2026-10-05', deliveredAt: tonight });
    });
  });
});

describe('delivery date input (shared contract)', () => {
  const parse = (value: unknown) => deliveryDateInputSchema.safeParse(value);

  it('keeps a calendar date as a string — it is a date, not an instant', () => {
    expect(parse('2026-10-04')).toEqual({ success: true, data: '2026-10-04' });
    expect(parse(' 2026-10-04 ')).toEqual({ success: true, data: '2026-10-04' });
    expect(parse('2024-02-29')).toEqual({ success: true, data: '2024-02-29' });
  });

  it('rejects a day that does not exist rather than rolling it over', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29', '2026-04-31']) expect([bad, parse(bad).success]).toEqual([bad, false]);
    expect(parse('2026-02-30').error?.issues[0]?.message).toBe('Delivery date is not a valid date');
  });

  it('still accepts the timestamps the API took before, as instants', () => {
    expect(parse('2026-10-04T08:15:00.000Z')).toEqual({ success: true, data: new Date('2026-10-04T08:15:00.000Z') });
    expect(parse('2026-10-04T13:45:00+05:30')).toEqual({ success: true, data: new Date('2026-10-04T08:15:00.000Z') });
    const instant = new Date('2026-10-04T08:15:00.000Z');
    expect(parse(instant)).toEqual({ success: true, data: instant });
  });

  it('rejects anything that is not a date', () => {
    for (const bad of ['', 'tomorrow', '04/10/2026x', {}, [], true, false]) expect([bad, parse(bad).success]).toEqual([bad, false]);
  });

  it('is optional on both endpoints, and null means "not sent"', () => {
    expect(markDeliveredSchema.parse({})).toEqual({});
    expect(markDeliveredSchema.parse({ actualDelivery: null })).toEqual({ actualDelivery: null });
    expect(markDeliveredSchema.parse({ actualDelivery: '2026-10-04' })).toEqual({ actualDelivery: '2026-10-04' });
    expect(completeDeliverySchema.parse({ notes: 'ok' })).toEqual({ notes: 'ok' });
    expect(completeDeliverySchema.parse({ actualDelivery: '2026-10-04', notes: 'ok' })).toEqual({ actualDelivery: '2026-10-04', notes: 'ok' });
    expect(markDeliveredSchema.safeParse({ actualDelivery: '2026-02-30' }).success).toBe(false);
    expect(completeDeliverySchema.safeParse({ actualDelivery: 'garbage' }).success).toBe(false);
  });

  it('isCalendarDateString accepts only real YYYY-MM-DD days', () => {
    expect(isCalendarDateString('2026-10-04')).toBe(true);
    for (const bad of ['2026-02-30', '2026-10-4', '2026-10-04T00:00:00Z', '', null, undefined, 20261004]) expect(isCalendarDateString(bad)).toBe(false);
  });
});
