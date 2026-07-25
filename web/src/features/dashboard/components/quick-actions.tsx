import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, CalendarClock, FileText, PackagePlus, ShoppingCart, UserPlus, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerFormDialog } from '@/features/customers/components/customer-form-dialog';
import { UnitFormDialog } from '@/features/inventory/components/unit-form-dialog';
import { QuotationFormDialog } from '@/features/sales/components/quotation-form-dialog';
import { BookingFormDialog } from '@/features/sales/components/booking-form-dialog';

type ActionKey = 'customer' | 'inventory' | 'quotation' | 'booking';

export function QuickActions(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<ActionKey | null>(null);

  const actions: { key: string; label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean }[] = [
    { key: 'customer', label: 'Add Customer', icon: UserPlus, onClick: () => setOpen('customer') },
    { key: 'inventory', label: 'Add Inventory', icon: PackagePlus, onClick: () => setOpen('inventory') },
    { key: 'quotation', label: 'Create Quotation', icon: FileText, onClick: () => setOpen('quotation') },
    { key: 'booking', label: 'Create Booking', icon: ShoppingCart, onClick: () => setOpen('booking') },
    { key: 'payment', label: 'Receive Payment', icon: Banknote, onClick: () => navigate('/bookings') },
    { key: 'delivery', label: 'Schedule Delivery', icon: CalendarClock, onClick: () => navigate('/bookings') },
    { key: 'service', label: 'Book Service', icon: Wrench, onClick: () => undefined, disabled: true },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Button key={a.key} variant="outline" size="sm" onClick={a.onClick} disabled={a.disabled} title={a.disabled ? 'Arrives with the Service module' : undefined}>
              <Icon className="h-4 w-4" /> {a.label}
            </Button>
          );
        })}
      </div>
      <CustomerFormDialog open={open === 'customer'} onOpenChange={(o) => !o && setOpen(null)} />
      <UnitFormDialog open={open === 'inventory'} onOpenChange={(o) => !o && setOpen(null)} />
      <QuotationFormDialog open={open === 'quotation'} onOpenChange={(o) => !o && setOpen(null)} />
      <BookingFormDialog open={open === 'booking'} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}
