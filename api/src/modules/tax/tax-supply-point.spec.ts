import { SaleTaxError } from './sale-tax.errors';
import { calendarDateInTimeZone, resolveSaleTaxPoint } from './tax-point';
import { resolveSupplyContext } from './tax-supply';

const expectCode = (fn: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(SaleTaxError);
  expect((thrown as SaleTaxError).code).toBe(code);
};

describe('resolveSupplyContext', () => {
  it('same state code → INTRA', () => {
    expect(resolveSupplyContext('24', '24')).toEqual({ supplyType: 'INTRA', supplierStateCode: '24', placeOfSupplyStateCode: '24' });
  });

  it('different state codes → INTER', () => {
    expect(resolveSupplyContext('24', '27')).toEqual({ supplyType: 'INTER', supplierStateCode: '24', placeOfSupplyStateCode: '27' });
  });

  it('ignores surrounding whitespace only', () => {
    expect(resolveSupplyContext(' 24 ', '24').supplyType).toBe('INTRA');
  });

  it.each([null, undefined, '', '  '])('a missing company state code (%p) fails closed', (v) => {
    expectCode(() => resolveSupplyContext(v, '24'), 'SUPPLIER_STATE_CODE_MISSING');
  });

  it.each([null, undefined, '', '  '])('a missing customer state code (%p) fails closed — no fallback', (v) => {
    expectCode(() => resolveSupplyContext('24', v), 'CUSTOMER_STATE_CODE_MISSING');
  });

  it.each(['GJ', 'Gujarat', '2', '024', '2A'])('a malformed code (%p) fails closed rather than being compared', (v) => {
    expectCode(() => resolveSupplyContext(v, '24'), 'STATE_CODE_INVALID');
    expectCode(() => resolveSupplyContext('24', v), 'STATE_CODE_INVALID');
  });
});

describe('calendarDateInTimeZone / resolveSaleTaxPoint', () => {
  it('gives the calendar date of an instant in the given time zone', () => {
    // 2026-06-30 19:00 UTC is already 1 July (00:30) in India.
    const instant = new Date('2026-06-30T19:00:00.000Z');
    expect(calendarDateInTimeZone(instant, 'Asia/Kolkata')).toBe('2026-07-01');
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2026-06-30');
    // 2026-06-30 18:29 UTC is still 30 June (23:59) in India.
    expect(calendarDateInTimeZone(new Date('2026-06-30T18:29:00.000Z'), 'Asia/Kolkata')).toBe('2026-06-30');
    expect(calendarDateInTimeZone(new Date('2026-01-01T00:00:00.000Z'), 'America/New_York')).toBe('2025-12-31');
  });

  it('an invalid time zone or instant fails closed', () => {
    expectCode(() => calendarDateInTimeZone(new Date(), 'Not/AZone'), 'TAX_POINT_UNRESOLVED');
    expectCode(() => calendarDateInTimeZone(new Date('nonsense'), 'Asia/Kolkata'), 'TAX_POINT_UNRESOLVED');
  });

  it('the sale tax point is currently the invoice instant in the company time zone (temporary assumption)', () => {
    expect(resolveSaleTaxPoint({ invoicedAt: new Date('2026-06-30T19:00:00.000Z') }, 'Asia/Kolkata')).toBe('2026-07-01');
  });
});
