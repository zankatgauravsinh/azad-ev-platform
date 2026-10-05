import { SaleTaxError, SaleTaxErrorCode } from './sale-tax.errors';
import { isCalendarDate, type CalendarDate } from './tax-calendar';

/**
 * Tax-point resolution. Pure — no database, no Nest. This is the ONLY place an instant is turned into
 * the calendar date handed to the tax engine as `asOf`.
 */

/** The calendar date ('YYYY-MM-DD') of an instant in an IANA time zone (e.g. the company's). */
export function calendarDateInTimeZone(instant: Date, timeZone: string): CalendarDate {
  let date: string;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    date = `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    throw new SaleTaxError(SaleTaxErrorCode.TAX_POINT_UNRESOLVED, `the tax-point date could not be resolved in time zone "${timeZone}"`);
  }
  if (!isCalendarDate(date)) throw new SaleTaxError(SaleTaxErrorCode.TAX_POINT_UNRESOLVED, 'the tax-point date could not be resolved');
  return date;
}

/** The events of a sale that a tax-point rule could be based on. Extend when more become relevant. */
export interface SaleTaxPointEvents {
  invoicedAt: Date;
}

/**
 * TEMPORARY TAX-POINT ASSUMPTION — NOT CA APPROVED.
 *
 * The tax point of a sale is taken to be its invoice-generation instant, expressed as a calendar date
 * in the company's time zone. Which event actually sets the tax point (invoice vs delivery vs other)
 * is an open CA decision. This function is the single place that encodes the choice: change it here.
 *
 * Note: if the answer is "delivery date", that date does not exist yet when the invoice is generated,
 * so the calculation itself would have to move to the delivery step — an architectural change, not a
 * one-line edit.
 */
export function resolveSaleTaxPoint(events: SaleTaxPointEvents, companyTimeZone: string): CalendarDate {
  return calendarDateInTimeZone(events.invoicedAt, companyTimeZone);
}
