import { businessDateOf, noonOf, type BusinessDate } from '../../common/utils/business-date';

/**
 * Delivery-date rules. Pure — no database, no Nest. The single place that turns what a client sent
 * into the delivery that is recorded; both entry points (Booking → Deliver and the Delivery module)
 * reach it through BookingsService.markDelivered().
 *
 * INTERPRETATION
 *  The delivery date is a business calendar date in the company's time zone. It may be today or any
 *  past date; a future date is refused. No limit is placed on how far back it may be.
 *
 * STORAGE (Booking.actualDelivery and Delivery.deliveredAt are DateTime columns — unchanged)
 *  - today, or nothing sent → the current instant, exactly as before: the real handover time.
 *  - a past date            → 12:00 noon of that date in the company's time zone. The time of day of a
 *                             back-dated delivery is not known; noon keeps the stored instant on the
 *                             chosen date wherever it is later formatted (see noonOf).
 *  - an instant (older API clients sending a timestamp) → stored as sent; its business date is the
 *                             date of that instant in the company's time zone.
 *
 * The delivery date is NOT a tax input: the tax point is resolved from the invoice (see tax-point.ts).
 */
export interface ResolvedDeliveryDate {
  /** The calendar date of the delivery in the company's time zone. */
  businessDate: BusinessDate;
  /** The instant to store. */
  deliveredAt: Date;
}

export class FutureDeliveryDateError extends Error {
  constructor(readonly businessDate: BusinessDate, readonly today: BusinessDate) {
    super('Delivery date cannot be in the future');
    this.name = 'FutureDeliveryDateError';
  }
}

export function resolveDeliveryDate(input: string | Date | null | undefined, now: Date, timeZone: string): ResolvedDeliveryDate {
  const today = businessDateOf(now, timeZone);
  if (input === null || input === undefined) return { businessDate: today, deliveredAt: now };

  const businessDate = typeof input === 'string' ? input : businessDateOf(input, timeZone);
  // 'YYYY-MM-DD' strings order chronologically.
  if (businessDate > today) throw new FutureDeliveryDateError(businessDate, today);

  if (typeof input !== 'string') return { businessDate, deliveredAt: input };
  return { businessDate, deliveredAt: businessDate === today ? now : noonOf(businessDate, timeZone) };
}
