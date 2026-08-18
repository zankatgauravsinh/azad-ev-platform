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
import { useCategories, useFinanceMutations, useVendors } from '../hooks';
import { payMethodLabel } from '../meta';

export function CreateExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { createExpense } = useFinanceMutations();
  const { data: categories } = useCategories();
  const { data: vendors } = useVendors({ pageSize: 100, status: 'ACTIVE' });
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paid, setPaid] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const reset = (): void => { setCategoryId(''); setVendorId(''); setAmount(''); setGst(''); setPaymentMethod('CASH'); setPaid(true); setDueDate(''); setReference(''); setDescription(''); };

  const submit = async (asDraft: boolean): Promise<void> => {
    if (!categoryId) { toast.error('Select a category'); return; }
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await createExpense.mutateAsync({
        categoryId,
        vendorId: vendorId || undefined,
        amount: Math.round(rupees * 100),
        gstAmount: gst ? Math.round(Number(gst) * 100) : 0,
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
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{categories?.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vendor (optional)</Label>
              <Select value={vendorId || 'none'} onValueChange={(v) => setVendorId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{vendors?.data.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>GST (₹)</Label><Input type="number" min={0} value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FINANCE_PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{payMethodLabel[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
          </div>
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
