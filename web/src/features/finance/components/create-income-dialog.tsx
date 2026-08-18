import { useState } from 'react';
import { toast } from 'sonner';
import { FINANCE_PAY_METHODS, INCOME_SOURCES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { CustomerCombobox } from '@/features/sales/components/customer-combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinanceMutations } from '../hooks';
import { payMethodLabel } from '../meta';

export function CreateIncomeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { createIncome } = useFinanceMutations();
  const [source, setSource] = useState('ACCESSORIES');
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [customerId, setCustomerId] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const reset = (): void => { setSource('ACCESSORIES'); setAmount(''); setGst(''); setPaymentMethod('CASH'); setCustomerId(''); setReference(''); setDescription(''); };

  const submit = async (): Promise<void> => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await createIncome.mutateAsync({
        source: source as never,
        amount: Math.round(rupees * 100),
        gstAmount: gst ? Math.round(Number(gst) * 100) : 0,
        paymentMethod: paymentMethod as never,
        customerId: customerId || undefined,
        referenceNumber: reference || undefined,
        description: description || undefined,
      });
      toast.success(`Income ${res.incomeNumber} recorded`);
      reset();
      onOpenChange(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Record income</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INCOME_SOURCES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FINANCE_PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{payMethodLabel[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>GST (₹)</Label><Input type="number" min={0} value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" /></div>
          </div>
          <div className="space-y-1"><Label>Customer (optional)</Label><CustomerCombobox value={customerId} onChange={(id) => setCustomerId(id)} /></div>
          <div className="space-y-1"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createIncome.isPending}>Record income</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
