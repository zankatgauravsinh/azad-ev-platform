import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import type { StaffDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useResetStaffPassword } from '../hooks';

// Mirrors the backend staffPassword rule (≥8 chars, a letter, a number) plus a confirmation match.
const schema = z
  .object({
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Za-z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordDialog({
  open,
  onOpenChange,
  staff,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staff?: StaffDto;
}): JSX.Element {
  const reset = useResetStaffPassword();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async (v) => {
    if (!staff) return;
    try {
      await reset.mutateAsync({ id: staff.id, password: v.password });
      // The password is never echoed back — only a generic confirmation.
      toast.success('Password reset successfully. Share the new temporary password securely with the staff member.');
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not reset password'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password{staff ? ` for ${staff.name}` : ''}</DialogTitle>
          <DialogDescription>
            This is an administrative reset. The current password can't be viewed — you're setting a new temporary
            password, and the staff member's existing sessions will be signed out immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Share the new temporary password securely — it is not shown again after you save.</span>
          </div>
          <div className="space-y-1.5">
            <Label>New temporary password</Label>
            <Input type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Confirm temporary password</Label>
            <Input type="password" autoComplete="new-password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
