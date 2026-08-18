import {
  WARRANTY_COVERAGE_ITEMS,
  DEFAULT_EXCLUDED_COVERAGE_ITEMS,
  type WarrantyCoverageItem,
  type WarrantyCoverageLine,
} from '@azad/shared';

/** Human labels for each coverage line item. */
const COVERAGE_LABELS: Record<WarrantyCoverageItem, string> = {
  MOTOR: 'Motor',
  BATTERY: 'Battery',
  CONTROLLER: 'Controller',
  CHARGER: 'Charger',
  DISPLAY: 'Display / Console',
  FRAME: 'Frame / Chassis',
  SUSPENSION: 'Suspension',
  BRAKE_COMPONENTS: 'Brake Components',
  ELECTRICAL_COMPONENTS: 'Electrical Components',
  ACCESSORIES: 'Accessories',
  CUSTOM: 'Custom',
};

export function coverageLabel(item: WarrantyCoverageItem): string {
  return COVERAGE_LABELS[item] ?? item;
}

/** The standard EV coverage schedule: everything covered except wear-and-tear parts. */
export function defaultCoverage(): WarrantyCoverageLine[] {
  const excluded = new Set<WarrantyCoverageItem>(DEFAULT_EXCLUDED_COVERAGE_ITEMS);
  return WARRANTY_COVERAGE_ITEMS.filter((item) => item !== 'CUSTOM').map((item) => ({
    item,
    label: coverageLabel(item),
    covered: !excluded.has(item),
    remarks: null,
  }));
}

/** Normalise incoming coverage lines, filling labels from the enum where absent. */
export function normaliseCoverage(lines: { item: WarrantyCoverageItem; label?: string; covered: boolean; remarks?: string | null }[]): WarrantyCoverageLine[] {
  return lines.map((l) => ({
    item: l.item,
    label: l.label?.trim() || coverageLabel(l.item),
    covered: l.covered,
    remarks: l.remarks?.trim() || null,
  }));
}

/** Whole days until `end` (negative once expired). */
export function daysBetween(from: Date, end: Date): number {
  return Math.ceil((end.getTime() - from.getTime()) / 86_400_000);
}

/** Add whole calendar months to a date (clamping the day for short months). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // overflowed into next month → clamp to last day
  return d;
}
