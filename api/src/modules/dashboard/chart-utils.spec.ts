import { fillMonths } from './chart-utils';

describe('fillMonths (dashboard charts)', () => {
  const now = new Date(2026, 6, 15); // Jul 2026

  it('returns exactly 6 months ending on the current month, oldest first', () => {
    const points = fillMonths([], now);
    expect(points).toHaveLength(6);
    expect(points.map((p) => p.label)).toEqual(['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']);
    expect(points[5]?.month).toBe('2026-07');
  });

  it('fills gaps with zero and maps existing months', () => {
    const points = fillMonths([{ month: '2026-07', amount: 500000n, count: 3 }], now);
    const jul = points.find((p) => p.month === '2026-07');
    const jun = points.find((p) => p.month === '2026-06');
    expect(jul).toMatchObject({ amount: '500000', count: 3 });
    expect(jun).toMatchObject({ amount: '0', count: 0 });
  });

  it('coerces string/number amounts to strings', () => {
    const points = fillMonths([{ month: '2026-06', amount: '250000', count: 1 }], now);
    expect(points.find((p) => p.month === '2026-06')?.amount).toBe('250000');
  });
});
