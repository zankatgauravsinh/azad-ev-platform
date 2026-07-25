import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LEAD_STATUSES, LeadStatus } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { leadStatusLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useChangeLeadStatus } from '../hooks';

export function ChangeStatusDialog({
  open,
  onOpenChange,
  customerId,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  current: LeadStatus;
}): JSX.Element {
  const [status, setStatus] = useState<LeadStatus>(current);
  const [reason, setReason] = useState('');
  const change = useChangeLeadStatus(customerId);

  useEffect(() => {
    if (open) {
      setStatus(current);
      setReason('');
    }
  }, [open, current]);

  const submit = async (): Promise<void> => {
    try {
      await change.mutateAsync({ leadStatus: status, lostReason: status === LeadStatus.LOST ? reason : undefined });
      toast.success(`Status changed to ${leadStatusLabel(status)}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not change status'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change lead status</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{leadStatusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {status === LeadStatus.LOST && (
            <div className="space-y-1.5">
              <Label>Reason for loss (required)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bought a competitor scooter" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={change.isPending || (status === current && status !== LeadStatus.LOST) || (status === LeadStatus.LOST && !reason.trim())}
          >
            {change.isPending ? 'Saving…' : 'Update status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
