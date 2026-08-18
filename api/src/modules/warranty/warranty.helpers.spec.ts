import { addMonths, coverageLabel, daysBetween, defaultCoverage, normaliseCoverage } from './warranty.helpers';

describe('warranty.helpers', () => {
  describe('defaultCoverage', () => {
    it('covers everything except wear-and-tear parts and omits CUSTOM', () => {
      const cov = defaultCoverage();
      const motor = cov.find((c) => c.item === 'MOTOR');
      const brakes = cov.find((c) => c.item === 'BRAKE_COMPONENTS');
      expect(motor?.covered).toBe(true);
      expect(brakes?.covered).toBe(false);
      expect(cov.some((c) => c.item === 'CUSTOM')).toBe(false);
      expect(cov.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
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
});
