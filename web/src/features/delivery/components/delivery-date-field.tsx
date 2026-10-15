import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The delivery date of a handover — one field, used by both places a delivery can be completed
 * (Booking → Deliver and the Delivery module). The value is a calendar date, 'YYYY-MM-DD', and is sent
 * to the API as that string: it is a date, not an instant.
 *
 * "Today" here is this device's date and only drives the default and the early warning. The server is
 * the authority: it decides today in the company's time zone, rejects a future date, and rejects a past
 * date before the booking's `earliestDelivery` (the later of the booking and purchase dates).
 */

/** The first date a delivery may be recorded on, as sent by the API. */
export interface DeliveryLowerBound {
  date: string;
  label: string;
}

/** Today's calendar date on this device, as a date-input value. */
export function todayDateInput(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const displayDate = (d: string): string => d.split('-').reverse().join('/');

/** Why a delivery date cannot be submitted, or null when it can. Today is always allowed, as on the server. */
export function deliveryDateError(value: string, notBefore?: DeliveryLowerBound, now: Date = new Date()): string | null {
  if (!value) return 'Choose the delivery date';
  const today = todayDateInput(now);
  if (value > today) return 'Delivery date cannot be in the future';
  if (notBefore && value < notBefore.date && value < today) return `Delivery date cannot be before the ${notBefore.label} (${displayDate(notBefore.date)})`;
  return null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  notBefore?: DeliveryLowerBound;
}

export function DeliveryDateField({ value, onChange, disabled, id = 'delivery-date', notBefore }: Props): JSX.Element {
  const error = deliveryDateError(value, notBefore);
  const today = todayDateInput();
  // A purchase date in the future must not block today's handover, so the minimum never passes today.
  const min = notBefore ? (notBefore.date < today ? notBefore.date : today) : undefined;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Delivery date</Label>
      <Input id={id} type="date" className="w-44" value={value} min={min} max={today} disabled={disabled} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">{notBefore && min !== today ? `Today, or a date back to the ${notBefore.label} (${displayDate(min!)}).` : 'Today or an earlier date.'}</p>}
    </div>
  );
}
