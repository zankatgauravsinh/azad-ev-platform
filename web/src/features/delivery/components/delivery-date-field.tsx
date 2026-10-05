import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The delivery date of a handover — one field, used by both places a delivery can be completed
 * (Booking → Deliver and the Delivery module). The value is a calendar date, 'YYYY-MM-DD', and is sent
 * to the API as that string: it is a date, not an instant.
 *
 * "Today" here is this device's date and only drives the default and the early warning. The server is
 * the authority: it decides today in the company's time zone and rejects a future date.
 */

/** Today's calendar date on this device, as a date-input value. */
export function todayDateInput(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Why a delivery date cannot be submitted, or null when it can. */
export function deliveryDateError(value: string, now: Date = new Date()): string | null {
  if (!value) return 'Choose the delivery date';
  if (value > todayDateInput(now)) return 'Delivery date cannot be in the future';
  return null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function DeliveryDateField({ value, onChange, disabled, id = 'delivery-date' }: Props): JSX.Element {
  const error = deliveryDateError(value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Delivery date</Label>
      <Input id={id} type="date" className="w-44" value={value} max={todayDateInput()} disabled={disabled} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">Today or an earlier date.</p>}
    </div>
  );
}
