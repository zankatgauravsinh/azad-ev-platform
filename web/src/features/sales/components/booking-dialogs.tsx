import { useState } from 'react';
import { toast } from 'sonner';
import {
  FINANCE_STATUSES,
  INSURANCE_STATUSES,
  PAYMENT_MODES,
  FinanceStatus,
  InsuranceStatus,
  PaymentMode,
} from '@azad/shared';
import type { BookingDto } from '../api';
import { apiErrorMessage } from '@/lib/api-client';
import { rupeesToPaise, paiseToRupees, formatPaise, formatPaiseExact } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/common/form-field';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi } from '../api';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { useSalesInvalidate } from '../hooks';

type BookingRef = Pick<BookingDto, 'id' | 'paymentSummary' | 'finance' | 'insurance' | 'insuranceCharge' | 'expectedDelivery' | 'pendingDocuments'>;
interface Props { open: boolean; onOpenChange: (o: boolean) => void; booking: BookingRef }

function useSubmit(onOpenChange: (o: boolean) => void) {
  const invalidate = useSalesInvalidate();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    try { await fn(); invalidate(); toast.success(ok); onOpenChange(false); }
    catch (e) { toast.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

export function PaymentDialog({ open, onOpenChange, booking }: Props): JSX.Element {
  const { busy, run } = useSubmit(onOpenChange);
  const [amount, setAmount] = useState(() => paiseToRupees(booking.paymentSummary.balance));
  const [mode, setMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayDateInput);
  const futureDate = paidOn > todayDateInput();
  // The server refuses anything above the balance due; checked here too so the user sees why before submitting.
  const balance = Number(booking.paymentSummary.balance);
  const tooMuch = rupeesToPaise(amount) > balance;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <FormField label="Amount (₹)">
            <Input type="number" min={1} max={paiseToRupees(balance)} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-invalid={tooMuch} />
            <p className={tooMuch ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{tooMuch ? `Cannot exceed the balance due of ${formatPaiseExact(balance)}` : `Balance due ${formatPaiseExact(balance)}`}</p>
          </FormField>
          <FormField label="Mode">
            <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref / cheque no" /></FormField>
          <div className="space-y-1.5">
            <Label htmlFor="payment-date">Received on</Label>
            <Input id="payment-date" type="date" className="w-44" max={todayDateInput()} value={paidOn} aria-invalid={futureDate} onChange={(e) => setPaidOn(e.target.value)} />
            {futureDate && <p className="text-xs text-destructive">Cannot be in the future</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || amount <= 0 || tooMuch || !paidOn || futureDate} onClick={() => run(() => salesApi.addPayment(booking.id, { amount: Number(rupeesToPaise(amount)), mode, reference: reference || undefined, paidAt: paidOn === todayDateInput() ? undefined : new Date(paidOn) }), 'Payment recorded')}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FinanceDialog({ open, onOpenChange, booking }: Props): JSX.Element {
  const { busy, run } = useSubmit(onOpenChange);
  const f = booking.finance;
  const [v, setV] = useState({ financeCompany: f?.financeCompany ?? '', downPayment: paiseToRupees(f?.downPayment ?? '0'), loanAmount: paiseToRupees(f?.loanAmount ?? '0'), emiAmount: paiseToRupees(f?.emiAmount ?? '0'), tenureMonths: f?.tenureMonths ?? 0, interestRate: Number(f?.interestRate ?? 0), disbursedAmount: paiseToRupees(f?.disbursedAmount ?? '0'), status: (f?.status ?? FinanceStatus.PENDING) as FinanceStatus });
  const set = (k: keyof typeof v, val: string | number) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Finance details</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField className="col-span-2" label="Finance company"><Input value={v.financeCompany} onChange={(e) => set('financeCompany', e.target.value)} /></FormField>
          <FormField label="Loan amount (₹)"><Input type="number" value={v.loanAmount} onChange={(e) => set('loanAmount', Number(e.target.value))} /></FormField>
          <FormField label="Down payment (₹)"><Input type="number" value={v.downPayment} onChange={(e) => set('downPayment', Number(e.target.value))} /></FormField>
          <FormField label="EMI (₹)"><Input type="number" value={v.emiAmount} onChange={(e) => set('emiAmount', Number(e.target.value))} /></FormField>
          <FormField label="Tenure (months)"><Input type="number" value={v.tenureMonths} onChange={(e) => set('tenureMonths', Number(e.target.value))} /></FormField>
          <FormField label="Status">
            <Select value={v.status} onValueChange={(val) => set('status', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FINANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !v.financeCompany} onClick={() => run(() => salesApi.upsertFinance(booking.id, { financeCompany: v.financeCompany, downPayment: Number(rupeesToPaise(v.downPayment)), loanAmount: Number(rupeesToPaise(v.loanAmount)), emiAmount: Number(rupeesToPaise(v.emiAmount)), tenureMonths: v.tenureMonths, interestRate: v.interestRate, disbursedAmount: Number(rupeesToPaise(v.disbursedAmount)), status: v.status }), 'Finance saved')}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InsuranceDialog({ open, onOpenChange, booking }: Props): JSX.Element {
  const { busy, run } = useSubmit(onOpenChange);
  const i = booking.insurance;
  // A new policy starts from the insurance priced into the booking.
  const [v, setV] = useState({ provider: i?.provider ?? '', policyNumber: i?.policyNumber ?? '', premium: paiseToRupees(i?.premium ?? booking.insuranceCharge ?? '0'), startDate: i?.startDate?.slice(0, 10) ?? '', endDate: i?.endDate?.slice(0, 10) ?? '', status: (i?.status ?? InsuranceStatus.PENDING) as InsuranceStatus });
  const set = (k: keyof typeof v, val: string | number) => setV((s) => ({ ...s, [k]: val }));
  // 'YYYY-MM-DD' strings compare chronologically; the server applies the same rule.
  const datesReversed = Boolean(v.startDate && v.endDate && v.endDate <= v.startDate);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Insurance details</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Provider"><Input value={v.provider} onChange={(e) => set('provider', e.target.value)} /></FormField>
          <FormField label="Policy number"><Input value={v.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} /></FormField>
          <FormField label="Premium (₹)"><Input type="number" value={v.premium} onChange={(e) => set('premium', Number(e.target.value))} /></FormField>
          <FormField label="Status">
            <Select value={v.status} onValueChange={(val) => set('status', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INSURANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Start date"><Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} /></FormField>
          <FormField label="End date">
            <Input type="date" value={v.endDate} min={v.startDate || undefined} aria-invalid={datesReversed} onChange={(e) => set('endDate', e.target.value)} />
            {datesReversed && <p className="text-xs text-destructive">Must be after the start date</p>}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !v.provider || datesReversed} onClick={() => run(() => salesApi.upsertInsurance(booking.id, { provider: v.provider, policyNumber: v.policyNumber || undefined, premium: Number(rupeesToPaise(v.premium)), startDate: v.startDate ? new Date(v.startDate) : undefined, endDate: v.endDate ? new Date(v.endDate) : undefined, status: v.status }), 'Insurance saved')}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelBookingDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: Pick<BookingDto, 'id' | 'code' | 'paymentSummary'>;
}): JSX.Element {
  const { busy, run } = useSubmit(onOpenChange);
  const [reason, setReason] = useState('');
  const paid = BigInt(booking.paymentSummary.paid) > 0n;
  const trimmed = reason.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cancel booking {booking.code}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">The reserved scooter is released back to Available. This cannot be undone.</p>
          {paid && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              {formatPaise(booking.paymentSummary.paid)} already paid will be <strong>retained</strong> (not refunded). The payment history is preserved.
            </p>
          )}
          <FormField label="Reason for cancellation">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this booking being cancelled?" />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep booking</Button>
          <Button variant="destructive" disabled={busy || !trimmed} onClick={() => run(() => salesApi.cancelBooking(booking.id, trimmed), 'Booking cancelled')}>Cancel booking</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleDeliveryDialog({ open, onOpenChange, booking }: Props): JSX.Element {
  const { busy, run } = useSubmit(onOpenChange);
  const [expectedDelivery, setExpected] = useState(booking.expectedDelivery?.slice(0, 10) ?? '');
  const [pendingDocuments, setPending] = useState(booking.pendingDocuments ?? '');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Schedule delivery</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <FormField label="Expected delivery date"><Input type="date" value={expectedDelivery} onChange={(e) => setExpected(e.target.value)} /></FormField>
          <FormField label="Pending documents"><Textarea rows={2} value={pendingDocuments} onChange={(e) => setPending(e.target.value)} placeholder="e.g. Address proof pending" /></FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => run(() => salesApi.scheduleDelivery(booking.id, { expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : undefined, pendingDocuments: pendingDocuments || undefined }), 'Delivery scheduled')}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
