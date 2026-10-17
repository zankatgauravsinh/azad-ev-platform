import {
  WARRANTY_MONTH_COMPONENTS,
  type WarrantyCoverageItem,
  type WarrantyCoverageLine,
  type WarrantyExtra,
  type WarrantyMonthComponent,
  warrantyExtrasSchema,
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

/** Normalise incoming coverage lines, filling labels from the enum where absent. */
export function normaliseCoverage(lines: { item: WarrantyCoverageItem; label?: string; covered: boolean; remarks?: string | null }[]): WarrantyCoverageLine[] {
  return lines.map((l) => ({
    item: l.item,
    label: l.label?.trim() || coverageLabel(l.item),
    covered: l.covered,
    remarks: l.remarks?.trim() || null,
  }));
}

export type ComponentMonths = Partial<Record<WarrantyMonthComponent, number | null>>;

/** A vehicle's stored extra items, or none when the stored value is not a valid list. */
export function readExtras(value: unknown): WarrantyExtra[] {
  const parsed = warrantyExtrasSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * The lines of a warranty card: the four main components (months put on by withMonths), then each extra item
 * typed in with the scooter.
 */
export function cardCoverage(extras: WarrantyExtra[]): WarrantyCoverageLine[] {
  return [
    ...WARRANTY_MONTH_COMPONENTS.map((item): WarrantyCoverageLine => ({ item, label: coverageLabel(item), covered: true, remarks: null })),
    ...extras.map((e): WarrantyCoverageLine => ({ item: 'CUSTOM', label: e.name, covered: true, remarks: null, months: e.months })),
  ];
}

/** The extra items on a card: its covered custom lines. */
export function extrasOf(lines: WarrantyCoverageLine[]): WarrantyExtra[] {
  return lines.filter((l) => l.item === 'CUSTOM' && l.covered && l.months).map((l) => ({ name: l.label, months: l.months as number }));
}

const isMonthComponent = (item: WarrantyCoverageItem): item is WarrantyMonthComponent => (WARRANTY_MONTH_COMPONENTS as readonly string[]).includes(item);

/**
 * Puts months and an end date on every coverage line, counted from `start`:
 *  - a main component (motor, battery, controller, charger) takes its own months when given — 0 means not
 *    covered — else the months already on the line, else `fallbackMonths`;
 *  - any other covered line keeps the months already on it, else `fallbackMonths`.
 * A main component missing from the lines is added, so the card always lists all four.
 */
export function withMonths(lines: WarrantyCoverageLine[], start: Date, componentMonths: ComponentMonths, fallbackMonths: number): WarrantyCoverageLine[] {
  const present = new Set(lines.map((l) => l.item));
  const missing = WARRANTY_MONTH_COMPONENTS.filter((c) => !present.has(c)).map((item): WarrantyCoverageLine => ({ item, label: coverageLabel(item), covered: true, remarks: null }));
  return [...missing, ...lines].map((l) => {
    const own = isMonthComponent(l.item) ? componentMonths[l.item] : null;
    const covered = own != null ? own > 0 : l.covered;
    const months = !covered ? null : (own ?? l.months ?? fallbackMonths);
    return { ...l, covered, months, validUntil: months ? addMonths(start, months).toISOString() : null };
  });
}

/** The warranty's overall period: its longest covered line, else `fallbackMonths`. */
export function periodOf(lines: WarrantyCoverageLine[], fallbackMonths: number): number {
  const months = lines.filter((l) => l.covered && l.months).map((l) => l.months as number);
  return months.length ? Math.max(...months) : fallbackMonths;
}

/** Each main component's months on the coverage lines (null when not tracked). */
export function componentMonthsOf(lines: WarrantyCoverageLine[]): Record<WarrantyMonthComponent, number | null> {
  return Object.fromEntries(
    WARRANTY_MONTH_COMPONENTS.map((c) => {
      const line = lines.find((l) => l.item === c);
      return [c, line ? (line.covered ? (line.months ?? null) : 0) : null];
    }),
  ) as Record<WarrantyMonthComponent, number | null>;
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
