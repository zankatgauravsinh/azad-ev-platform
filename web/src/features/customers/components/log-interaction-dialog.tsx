import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MANUAL_CUSTOMER_EVENTS, type CustomerEventType } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { eventTypeLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { customersApi } from '../api';

export function LogInteractionDialog({
  open,
  onOpenChange,
  customerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const [type, setType] = useState<CustomerEventType>(MANUAL_CUSTOMER_EVENTS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await customersApi.logInteraction(customerId, { type, note: note.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['customers', customerId, 'timeline'] });
      toast.success('Logged to timeline');
      setNote('');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not log interaction'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log interaction</DialogTitle>
          <DialogDescription>Records an immutable timeline entry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CustomerEventType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MANUAL_CUSTOMER_EVENTS.map((t) => <SelectItem key={t} value={t}>{eventTypeLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Log'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
