/**
 * Business calendar dates in a company's time zone. Pure — no database, no Nest.
 *
 * A "business date" is the calendar day ('YYYY-MM-DD') on which something happened for the company —
 * what a person means by "delivered on the 5th". It is always worked out in the COMPANY's time zone
 * (CompanySetting.timezone), never in the server's: the server may run in UTC while the showroom is in
 * Asia/Kolkata, and the two disagree about the date for part of every day.
 */

/** A calendar date in 'YYYY-MM-DD' form. */
export type BusinessDate = string;

/** The default of CompanySetting.timezone — used when a company has no usable time zone on record. */
export const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Kolkata';

/** The IANA zone to work in: the given one when the runtime knows it, otherwise the default. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim();
  if (!candidate) return DEFAULT_BUSINESS_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_BUSINESS_TIME_ZONE;
  }
}

/** The wall-clock reading of an instant in a time zone, expressed as if it were a UTC timestamp (ms). */
function wallClockAsUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant);
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/** The business date of an instant in a time zone. */
export function businessDateOf(instant: Date, timeZone: string): BusinessDate {
  return new Date(wallClockAsUtc(instant, timeZone)).toISOString().slice(0, 10);
}

/**
 * The instant at which it is 12:00 noon on `date` in `timeZone`.
 *
 * Noon is the anchor for a date whose time of day is unknown: it is the same calendar date in the
 * company's zone and in every zone within several hours of it (including UTC for Asia/Kolkata), so the
 * date survives being formatted by a server or a browser that is not in the company's zone. Noon is
 * also never skipped or repeated by a daylight-saving change.
 */
export function noonOf(date: BusinessDate, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, 12);
  const offsetAt = (t: number): number => wallClockAsUtc(new Date(t), timeZone) - t;
  // Two passes: the zone's offset at the first guess, then at the corrected instant (offset changes).
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess));
}
