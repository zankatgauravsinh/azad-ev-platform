import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCan } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { AccessorySalesTable } from './accessory-sales-table';
import { AccessorySaleFormDialog } from './accessory-sale-form-dialog';
import { AccessorySaleDetailDialog } from './accessory-sale-detail-dialog';

/**
 * Accessories sold to one customer (or with one of their bookings), each on its own invoice, with a button to sell
 * more. Shown on the customer and booking pages.
 */
export function AccessorySalesPanel({ customerId, customerName, bookingId }: { customerId: string; customerName: string; bookingId?: string }): JSX.Element | null {
  const canView = useCan('accessories.view');
  const canSell = useCan('accessories.sell');
  const [selling, setSelling] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  if (!canView) return null;

  const sell = canSell ? (
    <Button size="sm" variant="outline" onClick={() => setSelling(true)}>
      <ShoppingBag className="h-4 w-4" /> Sell accessories
    </Button>
  ) : undefined;

  return (
    <section className="space-y-3" aria-label="Accessory sales">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Accessories</h3>
          <p className="text-xs text-muted-foreground">Sold on their own invoice — not part of the scooter invoice.</p>
        </div>
        {sell}
      </div>
      <AccessorySalesTable filter={bookingId ? { bookingId } : { customerId }} showCustomer={false} emptyAction={sell} />
      <AccessorySaleFormDialog open={selling} onOpenChange={setSelling} preset={{ customerId, customerName, bookingId }} onDone={setCreated} />
      <AccessorySaleDetailDialog id={created} onOpenChange={(o) => !o && setCreated(null)} />
    </section>
  );
}
