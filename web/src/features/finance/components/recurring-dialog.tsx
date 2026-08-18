import { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FINANCE_PAY_METHODS } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCategories, useFinanceMutations, useRecurring } from '../hooks';
import { payMethodLabel } from '../meta';

export function RecurringDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { data: templates } = useRecurring();
  const { data: categories } = useCategories();
  const { createRecurring, removeRecurring, runRecurring } = useFinanceMutations();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  const [day, setDay] = useState('1');
  const [method, setMethod] = useState('BANK_TRANSFER');

  const add = async (): Promise<void> => {
    if (!name.trim() || !categoryId) { toast.error('Name and category are required'); return; }
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      await createRecurring.mutateAsync({ name: name.trim(), categoryId, amount: Math.round(rupees * 100), gstAmount: gst ? Math.round(Number(gst) * 100) : 0, dayOfMonth: Number(day) || 1, paymentMethod: method as never });
      toast.success('Recurring template added');
      setName(''); setAmount(''); setGst('');
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const run = async (): Promise<void> => {
    try { const r = await runRecurring.mutateAsync(); toast.success(r.created ? `${r.created} expense(s) generated` : 'Already generated for this month'); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Recurring expenses</DialogTitle></DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Rent, salaries, subscriptions — generated monthly.</p>
          <Button size="sm" onClick={run} disabled={runRecurring.isPending}><Play className="h-4 w-4" /> Generate this month</Button>
        </div>

        <ul className="space-y-1">
          {(templates?.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No templates yet.</li>}
          {templates?.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.category} · day {t.dayOfMonth} · {payMethodLabel[t.paymentMethod]}{t.lastRun ? ` · last ${t.lastRun}` : ''}</p>
              </div>
              <span className="font-medium">{formatPaise(t.total)}</span>
              {t.active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Paused</Badge>}
              <Button size="sm" variant="ghost" onClick={() => removeRecurring.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-semibold">New template</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop rent" /></div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{categories?.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>GST (₹)</Label><Input type="number" min={0} value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1"><Label>Day of month</Label><Input type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Payment</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FINANCE_PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{payMethodLabel[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={add} disabled={createRecurring.isPending}>Add template</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
