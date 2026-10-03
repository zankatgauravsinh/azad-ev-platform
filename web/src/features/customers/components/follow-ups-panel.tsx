import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { CalendarClock, Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { FOLLOW_UP_PRIORITIES, FollowUpPriority } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { priorityTone } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/common/empty-state';
import { useCustomerFollowUps } from '../hooks';
import { customersApi } from '../api';

const schema = z.object({
  dueAt: z.string().min(1, 'Pick a date & time'),
  priority: z.enum(FOLLOW_UP_PRIORITIES as [FollowUpPriority, ...FollowUpPriority[]]),
  note: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function FollowUpsPanel({ customerId }: { customerId: string }): JSX.Element {
  const qc = useQueryClient();
  const canEdit = useCan('customers.update');
  const { data: followUps = [] } = useCustomerFollowUps(customerId);
  const [open, setOpen] = useState(false);
  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dueAt: '', priority: FollowUpPriority.MEDIUM, note: '' },
  });

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['customers', customerId, 'follow-ups'] }) as Promise<void>;

  const onSubmit = handleSubmit(async (v) => {
    try {
      await customersApi.createFollowUp(customerId, { dueAt: new Date(v.dueAt), priority: v.priority, note: v.note || undefined });
      await refresh();
      await qc.invalidateQueries({ queryKey: ['customers', 'reminders'] });
      toast.success('Follow-up scheduled');
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not schedule'));
    }
  });

  const act = async (id: string, action: 'complete' | 'cancel'): Promise<void> => {
    if (action === 'complete') await customersApi.completeFollowUp(customerId, id);
    else await customersApi.cancelFollowUp(customerId, id);
    await refresh();
    await qc.invalidateQueries({ queryKey: ['customers', 'reminders'] });
  };

  const pending = followUps.filter((f) => f.status === 'PENDING');
  const done = followUps.filter((f) => f.status !== 'PENDING');

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Follow-ups</h3>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Schedule</Button>}
      </div>

      {followUps.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No follow-ups" description="Schedule a call or visit reminder." />
      ) : (
        <ul className="space-y-2">
          {[...pending, ...done].map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={priorityTone(f.priority)}>{f.priority}</Badge>
                  {f.isOverdue && <Badge variant="destructive">Overdue</Badge>}
                  {f.status === 'COMPLETED' && <Badge variant="success">Done</Badge>}
                  {f.status === 'CANCELLED' && <Badge variant="muted">Cancelled</Badge>}
                </div>
                <p className="mt-1">{new Date(f.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                {f.note && <p className="text-muted-foreground">{f.note}</p>}
              </div>
              {f.status === 'PENDING' && canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => act(f.id, 'complete')} aria-label="Complete"><Check className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => act(f.id, 'cancel')} aria-label="Cancel"><X className="h-4 w-4" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule follow-up</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Date &amp; time</Label>
              <Input type="datetime-local" {...register('dueAt')} />
              {errors.dueAt && <p className="text-xs text-destructive">{errors.dueAt.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller control={control} name="priority" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FOLLOW_UP_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea rows={2} {...register('note')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Schedule'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
