import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UNIT_STATUS_TRANSITIONS, type UnitStatus } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { unitStatusLabel } from '@/lib/labels';
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
import { UnitStatusBadge } from './unit-status-badge';
import { useChangeStatus } from '../hooks';

export function ChangeStatusDialog({
  open,
  onOpenChange,
  unitId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string;
  current: UnitStatus;
}): JSX.Element {
  const allowed = UNIT_STATUS_TRANSITIONS[current] ?? [];
  const [target, setTarget] = useState<UnitStatus | ''>('');
  const [note, setNote] = useState('');
  const changeStatus = useChangeStatus(unitId);

  useEffect(() => {
    if (open) {
      setTarget('');
      setNote('');
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    if (!target) return;
    try {
      await changeStatus.mutateAsync({ toStatus: target, note: note.trim() || undefined });
      toast.success(`Status changed to ${unitStatusLabel(target)}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not change status'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            Current: <UnitStatusBadge status={current} />
          </DialogDescription>
        </DialogHeader>

        {allowed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status changes are available from here.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>New status</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as UnitStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select new status" />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((s) => (
                    <SelectItem key={s} value={s}>
                      {unitStatusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!target || changeStatus.isPending}>
            {changeStatus.isPending ? 'Saving…' : 'Change status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
