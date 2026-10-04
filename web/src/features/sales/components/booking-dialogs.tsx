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
import { rupeesToPaise, paiseToRupees, formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { salesApi } from '../api';
import { useSalesInvalidate } from '../hooks';

type BookingRef = Pick<BookingDto, 'id' | 'paymentSummary' | 'finance' | 'insurance' | 'expectedDelivery' | 'pendingDocuments'>;
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Amount (₹)</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref / cheque no" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || amount <= 0} onClick={() => run(() => salesApi.addPayment(booking.id, { amount: Number(rupeesToPaise(amount)), mode, reference: reference || undefined }), 'Payment recorded')}>Record</Button>
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
          <div className="col-span-2 space-y-1.5"><Label>Finance company</Label><Input value={v.financeCompany} onChange={(e) => set('financeCompany', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Loan amount (₹)</Label><Input type="number" value={v.loanAmount} onChange={(e) => set('loanAmount', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Down payment (₹)</Label><Input type="number" value={v.downPayment} onChange={(e) => set('downPayment', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>EMI (₹)</Label><Input type="number" value={v.emiAmount} onChange={(e) => set('emiAmount', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Tenure (months)</Label><Input type="number" value={v.tenureMonths} onChange={(e) => set('tenureMonths', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={v.status} onValueChange={(val) => set('status', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FINANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
  const [v, setV] = useState({ provider: i?.provider ?? '', policyNumber: i?.policyNumber ?? '', premium: paiseToRupees(i?.premium ?? '0'), startDate: i?.startDate?.slice(0, 10) ?? '', endDate: i?.endDate?.slice(0, 10) ?? '', status: (i?.status ?? InsuranceStatus.PENDING) as InsuranceStatus });
  const set = (k: keyof typeof v, val: string | number) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Insurance details</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Provider</Label><Input value={v.provider} onChange={(e) => set('provider', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Policy number</Label><Input value={v.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Premium (₹)</Label><Input type="number" value={v.premium} onChange={(e) => set('premium', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={v.status} onValueChange={(val) => set('status', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INSURANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={v.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !v.provider} onClick={() => run(() => salesApi.upsertInsurance(booking.id, { provider: v.provider, policyNumber: v.policyNumber || undefined, premium: Number(rupeesToPaise(v.premium)), startDate: v.startDate ? new Date(v.startDate) : undefined, endDate: v.endDate ? new Date(v.endDate) : undefined, status: v.status }), 'Insurance saved')}>Save</Button>
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
          <div className="space-y-1.5">
            <Label>Reason for cancellation</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this booking being cancelled?" />
          </div>
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
          <div className="space-y-1.5"><Label>Expected delivery date</Label><Input type="date" value={expectedDelivery} onChange={(e) => setExpected(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Pending documents</Label><Textarea rows={2} value={pendingDocuments} onChange={(e) => setPending(e.target.value)} placeholder="e.g. Address proof pending" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => run(() => salesApi.scheduleDelivery(booking.id, { expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : undefined, pendingDocuments: pendingDocuments || undefined }), 'Delivery scheduled')}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
