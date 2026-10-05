import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Truck } from 'lucide-react';
import type { BookingDto } from '../api';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DeliveryDateField, deliveryDateError, todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { salesApi } from '../api';
import { useSalesInvalidate } from '../hooks';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: Pick<BookingDto, 'id' | 'code'>;
}

/** Booking → Deliver: confirms the handover with its delivery date (today by default). */
export function DeliverDialog({ open, onOpenChange, booking }: Props): JSX.Element {
  const invalidate = useSalesInvalidate();
  const [date, setDate] = useState(todayDateInput);
  const [busy, setBusy] = useState(false);
  // Each time the dialog opens it starts from today again.
  useEffect(() => { if (open) setDate(todayDateInput()); }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await salesApi.deliver(booking.id, { actualDelivery: date });
      invalidate();
      toast.success('Delivered');
      onOpenChange(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Deliver <span className="font-mono">{booking.code}</span></DialogTitle></DialogHeader>
        <DeliveryDateField id="booking-delivery-date" value={date} onChange={setDate} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" disabled={busy || deliveryDateError(date) !== null} onClick={submit}><Truck className="h-4 w-4" /> Confirm delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
