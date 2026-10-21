import { useState } from 'react';
import { toast } from 'sonner';
import { FINANCE_PAY_METHODS } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCategories, useFinanceMutations } from '../hooks';
import { NO_VENDOR, VendorSelect } from '@/features/vendors/components/vendor-select';
import { payMethodLabel } from '../meta';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';

function FieldError({ message }: { message: string | null }): JSX.Element | null {
  return message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null;
}

export function CreateExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { createExpense } = useFinanceMutations();
  const { data: categories } = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  // null = follow the category's input-credit setting.
  const [itc, setItc] = useState<boolean | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paid, setPaid] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayDateInput);
  // Field errors show once the user has tried to submit, next to the field they concern.
  const [tried, setTried] = useState(false);

  const reset = (): void => { setCategoryId(''); setVendorId(''); setAmount(''); setGst(''); setItc(null); setPaymentMethod('CASH'); setPaid(true); setDueDate(''); setReference(''); setDescription(''); setExpenseDate(todayDateInput()); setTried(false); };

  const rupees = Number(amount);
  const categoryItc = categories?.find((c) => c.id === categoryId)?.itcEligible ?? true;
  const errors = {
    category: !categoryId ? 'Select a category' : null,
    amount: !amount ? 'Enter the amount' : !Number.isFinite(rupees) || rupees <= 0 ? 'Enter an amount greater than zero' : null,
    date: !expenseDate ? 'Choose the expense date' : expenseDate > todayDateInput() ? 'The expense date cannot be in the future' : null,
  };
  const shown = (e: string | null): string | null => (tried ? e : null);

  const submit = async (asDraft: boolean): Promise<void> => {
    setTried(true);
    if (errors.category || errors.amount || errors.date) return;
    try {
      const res = await createExpense.mutateAsync({
        // Today is left to the server (the exact time is kept); an earlier day is sent as that date.
        expenseDate: expenseDate === todayDateInput() ? undefined : new Date(expenseDate),
        categoryId,
        vendorId: vendorId || undefined,
        amount: Math.round(rupees * 100),
        gstAmount: gst ? Math.round(Number(gst) * 100) : 0,
        itcEligible: itc,
        paymentMethod: paymentMethod as never,
        status: asDraft ? 'DRAFT' : undefined,
        paid: asDraft ? false : paid,
        dueDate: !paid && dueDate ? new Date(dueDate) : undefined,
        referenceNumber: reference || undefined,
        description: description || undefined,
      });
      toast.success(asDraft ? `Draft ${res.expenseNumber} saved` : `Expense ${res.expenseNumber} recorded`);
      reset();
      onOpenChange(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Record expense</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="expense-category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="expense-category" aria-invalid={Boolean(shown(errors.category))}><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{categories?.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <FieldError message={shown(errors.category)} />
            </div>
            <div className="space-y-1">
              <Label>Vendor (optional)</Label>
              <VendorSelect value={vendorId || NO_VENDOR} onChange={(v) => setVendorId(v === NO_VENDOR ? '' : v)} noneLabel="None" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="expense-amount">Amount (₹)</Label>
              <Input id="expense-amount" type="number" min={0} value={amount} aria-invalid={Boolean(shown(errors.amount))} onChange={(e) => setAmount(e.target.value)} />
              <FieldError message={shown(errors.amount)} />
            </div>
            <div className="space-y-1"><Label>GST (₹)</Label><Input type="number" min={0} value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FINANCE_PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{payMethodLabel[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
            <div className="space-y-1">
              <Label htmlFor="expense-date">Expense date</Label>
              <Input id="expense-date" type="date" max={todayDateInput()} value={expenseDate} aria-invalid={Boolean(shown(errors.date))} onChange={(e) => setExpenseDate(e.target.value)} />
              <FieldError message={shown(errors.date)} />
            </div>
          </div>
          {Number(gst) > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <Switch aria-label="GST claimable as input credit" checked={itc ?? categoryItc} onCheckedChange={setItc} />
              GST claimable as input credit{itc === null && <span className="text-xs text-muted-foreground">(as set for the category)</span>}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><Switch checked={paid} onCheckedChange={setPaid} /> Paid</label>
            {!paid && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Due</Label>
                <Input type="date" className="w-40" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => submit(true)} disabled={createExpense.isPending}>Save as draft</Button>
          <Button onClick={() => submit(false)} disabled={createExpense.isPending}>Record expense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
