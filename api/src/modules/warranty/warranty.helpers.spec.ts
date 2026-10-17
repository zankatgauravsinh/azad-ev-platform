import { addMonths, cardCoverage, componentMonthsOf, coverageLabel, daysBetween, extrasOf, normaliseCoverage, periodOf, readExtras, withMonths } from './warranty.helpers';

describe('warranty.helpers', () => {
  describe('cardCoverage', () => {
    it('lists the four main components, then the extra items typed in with the scooter', () => {
      const cov = cardCoverage([{ name: 'Hub bearings', months: 12 }]);
      expect(cov.map((c) => [c.item, c.label])).toEqual([['MOTOR', 'Motor'], ['BATTERY', 'Battery'], ['CONTROLLER', 'Controller'], ['CHARGER', 'Charger'], ['CUSTOM', 'Hub bearings']]);
      expect(cov.every((c) => c.covered)).toBe(true);
      expect(extrasOf(withMonths(cov, new Date('2026-10-15'), {}, 36))).toEqual([{ name: 'Hub bearings', months: 12 }]);
    });

    it('reads stored extras defensively', () => {
      expect(readExtras([{ name: 'Mirror', months: 6 }])).toEqual([{ name: 'Mirror', months: 6 }]);
      expect(readExtras(null)).toEqual([]);
      expect(readExtras([{ name: '', months: 6 }])).toEqual([]);
    });
  });

  describe('normaliseCoverage', () => {
    it('fills missing labels from the enum and trims remarks to null', () => {
      const [line] = normaliseCoverage([{ item: 'BATTERY', covered: true, remarks: '   ' }]);
      expect(line?.label).toBe(coverageLabel('BATTERY'));
      expect(line?.remarks).toBeNull();
    });
  });

  describe('addMonths', () => {
    it('adds calendar months', () => {
      expect(addMonths(new Date('2026-01-15'), 12).toISOString().slice(0, 10)).toBe('2027-01-15');
    });
    it('clamps day overflow (Jan 31 + 1 month → Feb 28)', () => {
      expect(addMonths(new Date('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    });
  });

  describe('daysBetween', () => {
    it('is negative once the end date has passed', () => {
      const from = new Date('2026-08-01');
      expect(daysBetween(from, new Date('2026-08-11'))).toBe(10);
      expect(daysBetween(from, new Date('2026-07-22'))).toBeLessThan(0);
    });
  });

  describe('component months', () => {
    const start = new Date('2026-10-15T06:30:00.000Z');
    const line = (l: ReturnType<typeof withMonths>, item: string) => l.find((c) => c.item === item);

    it("gives each main component its own months and end date; an extra item keeps its own", () => {
      const lines = withMonths(cardCoverage([{ name: 'Frame', months: 24 }]), start, { MOTOR: 36, BATTERY: 60, CONTROLLER: 12, CHARGER: 6 }, 24);
      expect(line(lines, 'MOTOR')).toMatchObject({ covered: true, months: 36, validUntil: addMonths(start, 36).toISOString() });
      expect(line(lines, 'BATTERY')?.months).toBe(60);
      expect(line(lines, 'CHARGER')?.validUntil?.slice(0, 10)).toBe('2027-04-15');
      expect(line(lines, 'CUSTOM')).toMatchObject({ label: 'Frame', covered: true, months: 24 });
      expect(periodOf(lines, 24)).toBe(60);
    });

    it('treats 0 months as not covered and a missing value as the fallback', () => {
      const lines = withMonths(cardCoverage([]), start, { MOTOR: 0, BATTERY: null }, 36);
      expect(line(lines, 'MOTOR')).toMatchObject({ covered: false, months: null, validUntil: null });
      expect(line(lines, 'BATTERY')?.months).toBe(36);
      expect(componentMonthsOf(lines)).toEqual({ MOTOR: 0, BATTERY: 36, CONTROLLER: 36, CHARGER: 36 });
    });

    it('adds a main component missing from custom coverage, and keeps months already on a line', () => {
      const custom = normaliseCoverage([{ item: 'FRAME', covered: true }]).map((l) => ({ ...l, months: 48 }));
      const lines = withMonths(custom, start, { CHARGER: 12 }, 24);
      expect(lines.map((l) => l.item)).toEqual(['MOTOR', 'BATTERY', 'CONTROLLER', 'CHARGER', 'FRAME']);
      expect(line(lines, 'FRAME')?.months).toBe(48);
      expect(line(lines, 'CHARGER')?.months).toBe(12);
      expect(line(lines, 'MOTOR')?.months).toBe(24);
    });

    it('falls back to the given period when nothing is covered', () => {
      expect(periodOf(withMonths([], start, { MOTOR: 0, BATTERY: 0, CONTROLLER: 0, CHARGER: 0 }, 18), 18)).toBe(18);
    });
  });
});
