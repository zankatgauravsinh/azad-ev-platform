import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BookingStatus,
  RTO_MAX_GST_RATE,
  RTO_SUPPLY_TYPES,
  RTO_SUPPLY_TYPE_LABEL,
  RtoSupplyType,
  computeRtoGst,
  gstRateToBp,
  type RtoInvoiceDto,
} from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact, paiseToRupees, rupeesToPaise } from '@/lib/money';
import { salesApi } from '@/features/sales/api';
import { CustomerCombobox } from '@/features/sales/components/customer-combobox';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rtoApi } from '../api';
import { useRtoMutations } from '../hooks';
import { useAuth } from '@/features/auth/auth-context';

/** Where the delivery date came from, and who may change it. */
function deliveryHint(isOwner: boolean, revising: boolean, source: 'DELIVERED' | 'EXPECTED' | null): string {
  const from = revising ? 'As on the invoice.' : source === 'DELIVERED' ? "The booking's delivery date." : source === 'EXPECTED' ? "The booking's expected delivery date (not delivered yet)." : 'The booking has no delivery date yet.';
  return `${from} ${isOwner ? 'As the owner, you can change it.' : 'Only the owner can change it.'}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Generate for this booking (from the booking page): customer and booking are fixed. */
  preset?: { customerId: string; bookingId: string };
  /** Revise this invoice (owner only): figures only, same number. */
  invoice?: RtoInvoiceDto;
  /** Called with the invoice that was generated or revised — or, when the booking already has one, that one. */
  onDone: (id: string) => void;
}

/**
 * Generate an RTO invoice (customer → booking → price, GST rate, supply type), or revise one. The price starts
 * at the scooter's list price and can be changed; GST is added on top and previewed with the same calculation
 * the server stores (computeRtoGst).
 */
export function RtoInvoiceFormDialog({ open, onOpenChange, preset, invoice, onDone }: Props): JSX.Element {
  const revising = Boolean(invoice);
  const { generate, revise } = useRtoMutations();
  const [customerId, setCustomerId] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [rate, setRate] = useState('');
  const [supplyType, setSupplyType] = useState<RtoSupplyType>(RtoSupplyType.INTRA);
  const [policyNumber, setPolicyNumber] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [tried, setTried] = useState(false);
  // Only the owner may change the delivery date; for everyone else it is the booking's (the API enforces this too).
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  // Each opening starts afresh: from the invoice being revised, or from the preset booking.
  useEffect(() => {
    if (!open) return;
    setTried(false);
    if (invoice) {
      setCustomerId(invoice.customer.id);
      setBookingId(invoice.booking.id);
      setPrice(String(paiseToRupees(invoice.listPrice)));
      setDiscount(invoice.discount === '0' ? '' : String(paiseToRupees(invoice.discount)));
      setRate(String(invoice.gstRate));
      setSupplyType(invoice.supplyType);
      setPolicyNumber(invoice.policyNumber ?? '');
      setDeliveryDate(invoice.deliveryDate ?? '');
    } else {
      setCustomerId(preset?.customerId ?? '');
      setBookingId(preset?.bookingId ?? '');
      setPrice('');
      setDiscount('');
      setRate('');
      setSupplyType(RtoSupplyType.INTRA);
      setPolicyNumber('');
      setDeliveryDate('');
    }
  }, [open, invoice, preset?.customerId, preset?.bookingId]);

  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['sales', 'bookings', { customerId, pageSize: 100, purpose: 'rto' }],
    queryFn: () => salesApi.listBookings({ customerId, pageSize: 100 }),
    // Only needed when the booking is picked here (not from the booking page, not when revising).
    enabled: open && !revising && !preset && Boolean(customerId),
  });
  const choices = (bookings?.data ?? []).filter((b) => b.status !== BookingStatus.CANCELLED);

  const { data: defaults } = useQuery({
    queryKey: ['rto-invoices', 'defaults', bookingId],
    queryFn: () => rtoApi.defaults(bookingId),
    enabled: open && !revising && Boolean(bookingId),
  });
  // A newly chosen booking fills in its defaults; the user can then change them.
  useEffect(() => {
    if (!defaults || revising) return;
    setPrice(String(paiseToRupees(defaults.listPrice)));
    setRate(String(defaults.gstRate));
    setSupplyType(defaults.supplyType);
    setPolicyNumber(defaults.policyNumber ?? '');
    setDeliveryDate(defaults.deliveryDate ?? '');
  }, [defaults, revising]);

  const existing = !revising ? defaults?.existing ?? null : null;
  const priceNum = Number(price);
  const discountNum = discount === '' ? 0 : Number(discount);
  const rateNum = Number(rate);
  const errors = {
    customer: !customerId ? 'Select the customer' : null,
    booking: !bookingId ? 'Select the booking' : null,
    price: !price ? 'Enter the list price' : !Number.isFinite(priceNum) || priceNum <= 0 ? 'Enter a price greater than zero' : null,
    discount: !Number.isFinite(discountNum) || discountNum < 0 ? 'Enter a discount of zero or more' : Number.isFinite(priceNum) && discountNum >= priceNum && priceNum > 0 ? 'The discount must be less than the list price' : null,
    rate:
      rate === '' ? 'Enter the GST rate'
        : !Number.isFinite(rateNum) || rateNum < 0 || rateNum > RTO_MAX_GST_RATE ? `Enter a rate from 0 to ${RTO_MAX_GST_RATE}%`
          : Math.abs(rateNum * 100 - Math.round(rateNum * 100)) > 1e-6 ? 'Use at most two decimals' : null,
  };
  const shown = (e: string | null): string | null => (tried ? e : null);
  const preview = useMemo(
    () => (errors.price || errors.discount || errors.rate ? null : computeRtoGst(BigInt(rupeesToPaise(priceNum) - rupeesToPaise(discountNum)), gstRateToBp(rateNum), supplyType)),
    [errors.price, errors.discount, errors.rate, priceNum, discountNum, rateNum, supplyType],
  );

  const busy = generate.isPending || revise.isPending;
  const submit = async (): Promise<void> => {
    setTried(true);
    if (errors.customer || errors.booking || errors.price || errors.discount || errors.rate || existing) return;
    const figures = {
      listPrice: rupeesToPaise(priceNum),
      discount: rupeesToPaise(discountNum),
      gstRate: rateNum,
      supplyType,
      policyNumber: policyNumber.trim() || null,
      // Left out for anyone but the owner: the API then uses the booking's date (and keeps it on a revision).
      ...(isOwner ? { deliveryDate: deliveryDate || null } : {}),
    };
    try {
      const saved = invoice
        ? await revise.mutateAsync({ id: invoice.id, body: figures })
        : await generate.mutateAsync({ customerId, bookingId, ...figures });
      toast.success(invoice ? `RTO invoice ${saved.invoiceNumber} regenerated` : `RTO invoice ${saved.invoiceNumber} generated`);
      onOpenChange(false);
      onDone(saved.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  const halfRate = (rateNum / 2).toFixed(2);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `Edit RTO invoice ${invoice.invoiceNumber}` : 'Generate RTO invoice'}</DialogTitle>
          <DialogDescription>
            {invoice
              ? 'Change the figures and regenerate. The invoice keeps its number; the previous figures are kept in the activity log.'
              : "List price − discount is the basic price; GST is added on top. The list price starts at the scooter's."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rto-customer">Customer</Label>
            {revising || preset ? (
              <Input id="rto-customer" value={invoice ? `${invoice.customer.name} · ${invoice.customer.phone}` : 'From the booking'} disabled readOnly />
            ) : (
              <CustomerCombobox id="rto-customer" value={customerId} onChange={(id) => { setCustomerId(id); setBookingId(''); }} />
            )}
            {shown(errors.customer) && <p className="text-xs text-destructive">{errors.customer}</p>}
          </div>
          <FormField label="Booking" error={shown(errors.booking)}>
            {revising || preset ? (
              <Input value={invoice ? `${invoice.booking.code} · ${invoice.vehicle.vin}` : 'This booking'} disabled readOnly />
            ) : (
              <Select value={bookingId} onValueChange={setBookingId} disabled={!customerId || bookingsLoading || choices.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={!customerId ? 'Select the customer first' : bookingsLoading ? 'Loading…' : choices.length === 0 ? 'No open bookings' : 'Select booking'} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="font-mono">{b.code}</span> · {b.unit.vin} · {b.unit.variant.model.name} {b.unit.variant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>

        {existing ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <span>This booking already has RTO invoice <span className="font-mono">{existing.invoiceNumber}</span> — a booking has only one.</span>
            <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onDone(existing.id); }}>Open it</Button>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="List price (₹)" error={shown(errors.price)}>
                <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={Boolean(shown(errors.price))} />
              </FormField>
              <FormField label="Discount (₹)" error={shown(errors.discount)}>
                <Input type="number" min={0} step="0.01" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-invalid={Boolean(shown(errors.discount))} />
              </FormField>
              <FormField label="GST rate (%)" error={shown(errors.rate)}>
                <Input type="number" min={0} max={RTO_MAX_GST_RATE} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={Boolean(shown(errors.rate))} />
              </FormField>
              <FormField label="Supply">
                <Select value={supplyType} onValueChange={(v) => setSupplyType(v as RtoSupplyType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RTO_SUPPLY_TYPES.map((t) => <SelectItem key={t} value={t}>{RTO_SUPPLY_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
            </div>
            {defaults?.supplyTypeHint && !revising && <p className="-mt-2 text-xs text-muted-foreground">{defaults.supplyTypeHint}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Insurance policy no.">
                <Input value={policyNumber} maxLength={80} placeholder="Optional" onChange={(e) => setPolicyNumber(e.target.value)} />
              </FormField>
              <FormField label="Delivery date">
                <Input type="date" value={deliveryDate} disabled={!isOwner} onChange={(e) => setDeliveryDate(e.target.value)} />
              </FormField>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{deliveryHint(isOwner, revising, defaults?.deliveryDateSource ?? null)}</p>

            <dl aria-label="Invoice amount" className="space-y-1 rounded-lg bg-secondary px-4 py-3 text-sm">
              {discountNum > 0 && !errors.price && !errors.discount && (
                <div className="flex justify-between text-muted-foreground"><dt>List price − discount</dt><dd className="tabular-nums">{formatPaiseExact(rupeesToPaise(priceNum))} − {formatPaiseExact(rupeesToPaise(discountNum))}</dd></div>
              )}
              <div className="flex justify-between"><dt>Basic price (taxable value)</dt><dd className="tabular-nums">{preview ? formatPaiseExact(preview.taxable) : '—'}</dd></div>
              {supplyType === RtoSupplyType.INTRA ? (
                <>
                  <div className="flex justify-between"><dt>CGST @ {halfRate}%</dt><dd className="tabular-nums">{preview ? formatPaiseExact(preview.cgst) : '—'}</dd></div>
                  <div className="flex justify-between"><dt>SGST @ {halfRate}%</dt><dd className="tabular-nums">{preview ? formatPaiseExact(preview.sgst) : '—'}</dd></div>
                </>
              ) : (
                <div className="flex justify-between"><dt>IGST @ {rateNum.toFixed(2)}%</dt><dd className="tabular-nums">{preview ? formatPaiseExact(preview.igst) : '—'}</dd></div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{preview ? formatPaiseExact(preview.total) : '—'}</dd></div>
            </dl>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {!existing && <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : invoice ? 'Regenerate invoice' : 'Generate invoice'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
