/**
 * Calendar-date helpers for tax-rate effective periods. Pure — no database, no Nest.
 *
 * A TaxRate's effectiveFrom / effectiveTo are business CALENDAR DATES, not instants. They are stored
 * as 00:00 UTC of that date and compared as 'YYYY-MM-DD' strings, so no timezone arithmetic is ever
 * applied to them. Both ends of a period are INCLUSIVE: 2026-01-01 → 2026-06-30 followed by
 * 2026-07-01 → (open) is adjacent, with no gap and no overlap.
 */

/** A calendar date in 'YYYY-MM-DD' form. */
export type CalendarDate = string;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30, timestamps, etc.). */
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The calendar date a stored effective-date value represents (its UTC date part). */
export function toCalendarDate(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

/** Normalises a date to 00:00 UTC of its calendar date — the canonical stored form. */
export function startOfCalendarDay(date: Date): Date {
  return new Date(`${toCalendarDate(date)}T00:00:00.000Z`);
}

/** Whether the inclusive period [from, to] contains `day`. `to === null` is open-ended. */
export function periodCovers(from: CalendarDate, to: CalendarDate | null, day: CalendarDate): boolean {
  return from <= day && (to === null || day <= to);
}

/** Whether two inclusive periods share at least one calendar day. `null` end is open-ended. */
export function periodsOverlap(aFrom: CalendarDate, aTo: CalendarDate | null, bFrom: CalendarDate, bTo: CalendarDate | null): boolean {
  return (bTo === null || aFrom <= bTo) && (aTo === null || bFrom <= aTo);
}
