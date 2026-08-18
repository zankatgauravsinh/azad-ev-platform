import { useState } from 'react';
import { toast } from 'sonner';
import { BANK_DIRECTIONS, BANK_TXN_TYPES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinanceMutations } from '../hooks';

/** DEPOSIT/WITHDRAWAL have a fixed direction; the rest let the user choose. */
const FIXED = new Set(['DEPOSIT', 'WITHDRAWAL']);

export function CreateBankDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { createBank } = useFinanceMutations();
  const [type, setType] = useState('DEPOSIT');
  const [direction, setDirection] = useState('DEBIT');
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const reset = (): void => { setType('DEPOSIT'); setDirection('DEBIT'); setAmount(''); setBankName(''); setReference(''); setNotes(''); };

  const submit = async (): Promise<void> => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await createBank.mutateAsync({
        type: type as never,
        direction: FIXED.has(type) ? undefined : (direction as never),
        amount: Math.round(rupees * 100),
        bankName: bankName || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success(`Bank ${res.txnNumber} recorded`);
      reset();
      onOpenChange(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Record bank transaction</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BANK_TXN_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!FIXED.has(type) && (
              <div className="space-y-1">
                <Label>Direction</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BANK_DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{titleCase(d)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>Bank</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Optional" /></div>
            <div className="space-y-1"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createBank.isPending}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
