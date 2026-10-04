import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import type { RoleListItem } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRoleMutations } from '../hooks';

const schema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(60, 'Role name must be at most 60 characters'),
  description: z.string().trim().max(200, 'Description must be at most 200 characters'),
});
type FormValues = z.infer<typeof schema>;

export type RoleFormMode = 'create' | 'edit' | 'duplicate';

const TITLES: Record<RoleFormMode, string> = { create: 'New role', edit: 'Edit role', duplicate: 'Duplicate role' };
const CTAS: Record<RoleFormMode, string> = { create: 'Create role', edit: 'Save changes', duplicate: 'Create copy' };

/**
 * Create / edit (name + description) / duplicate a custom role. Permissions are managed separately in
 * the permission editor (PUT /roles/:id/permissions). On create/duplicate, `onSaved` receives the new
 * role id so the caller can open the permission editor next.
 */
export function RoleFormDialog({
  mode,
  open,
  onOpenChange,
  role,
  onSaved,
}: {
  mode: RoleFormMode;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role?: RoleListItem;
  onSaved?: (id: string) => void;
}): JSX.Element {
  const { create, update, duplicate } = useRoleMutations();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && role) reset({ name: role.name, description: role.description ?? '' });
    else if (mode === 'duplicate' && role) reset({ name: `${role.name} (copy)`, description: role.description ?? '' });
    else reset({ name: '', description: '' });
  }, [open, mode, role, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const description = v.description.trim() ? v.description.trim() : null;
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync({ name: v.name, description, permissionKeys: [] });
        toast.success(`Role “${created.name}” created`);
        onOpenChange(false);
        onSaved?.(created.id);
      } else if (mode === 'edit' && role) {
        await update.mutateAsync({ id: role.id, input: { name: v.name, description } });
        toast.success('Role updated');
        onOpenChange(false);
      } else if (mode === 'duplicate' && role) {
        const copy = await duplicate.mutateAsync({ id: role.id, input: { name: v.name, description: description ?? undefined } });
        toast.success(`Role “${copy.name}” created from ${role.name}`);
        onOpenChange(false);
        onSaved?.(copy.id);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the role'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {mode === 'duplicate'
              ? `Creates a new custom role with the same permissions as ${role?.name ?? 'the source'}.`
              : mode === 'create'
                ? 'Create a custom role, then choose its permissions.'
                : 'Update the role name and description.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" autoFocus {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea id="role-description" rows={2} placeholder="Optional" {...register('description')} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : CTAS[mode]}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
