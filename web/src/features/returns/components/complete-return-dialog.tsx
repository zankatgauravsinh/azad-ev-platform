import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_MODES, RETURN_DISPOSITIONS, type PaymentMode, type ReturnDisposition, type VehicleReturnDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise, rupeesToPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dispositionLabel } from '../meta';
import { useReturnMutations } from '../hooks';

/**
 * Financial confirmation before completing a return. It DISPLAYS the backend figures
 * (sale total, amount paid) and shows an estimated refund; the authoritative refund /
 * credit-note values come back from the API response — the UI never recomputes accounting.
 */
export function CompleteReturnDialog({ ret, open, onOpenChange }: { ret: VehicleReturnDto; open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { complete } = useReturnMutations();
  const [disposition, setDisposition] = useState<ReturnDisposition>('AVAILABLE');
  const [deductionRupees, setDeductionRupees] = useState('');
  const [deductionReason, setDeductionReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMode>('CASH');
  const [refundReference, setRefundReference] = useState('');

  const paid = Number(ret.amountPaid);
  const deductionPaise = deductionRupees ? rupeesToPaise(Number(deductionRupees)) : 0;
  const estimatedRefund = Math.max(0, paid - deductionPaise);
  const deductionInvalid = deductionPaise > paid;
  const reasonMissing = deductionPaise > 0 && !deductionReason.trim();

  const submit = async (): Promise<void> => {
    try {
      const res = await complete.mutateAsync({
        id: ret.id,
        body: { disposition, deductionAmount: deductionPaise, deductionReason: deductionReason.trim() || undefined, refundMethod, refundReference: refundReference.trim() || undefined },
      });
      const refunded = res.refunds.reduce((a, r) => a + Number(r.amount), 0);
      toast.success(refunded > 0 ? `Return completed · refund ${formatPaise(refunded)}` : 'Return completed');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not complete the return'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete return {ret.returnNumber}</DialogTitle>
          <DialogDescription>This issues the credit note and refund and returns the vehicle to inventory. It cannot be undone.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
          <Figure label="Original sale" value={formatPaise(ret.saleTotal)} />
          <Figure label="Amount paid" value={formatPaise(ret.amountPaid)} />
          <Figure label="Approved deduction" value={deductionPaise ? formatPaise(deductionPaise) : '—'} />
          <Figure label="Estimated refund" value={formatPaise(estimatedRefund)} hint="final value confirmed by server" tone />
        </dl>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Vehicle disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as ReturnDisposition)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RETURN_DISPOSITIONS.map((d) => <SelectItem key={d} value={d}>{dispositionLabel[d]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Refund method</Label>
            <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as PaymentMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Deduction (₹, optional)</Label>
            <Input type="number" min={0} value={deductionRupees} onChange={(e) => setDeductionRupees(e.target.value)} placeholder="0" />
            {deductionInvalid && <p className="text-xs text-destructive">Cannot exceed the amount paid ({formatPaise(ret.amountPaid)}).</p>}
          </div>
          <div className="space-y-1">
            <Label>Refund reference (optional)</Label>
            <Input value={refundReference} onChange={(e) => setRefundReference(e.target.value)} placeholder="UTR / txn id" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Deduction reason {deductionPaise > 0 && <span className="text-destructive">*</span>}</Label>
            <Input value={deductionReason} onChange={(e) => setDeductionReason(e.target.value)} placeholder="Required when a deduction is applied" disabled={deductionPaise === 0} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={complete.isPending || deductionInvalid || reasonMissing}>
            <CheckCircle2 className="h-4 w-4" /> Complete return
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone ? 'text-accent' : ''}`}>{value}</dd>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
