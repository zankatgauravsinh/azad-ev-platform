import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { ROLES, Role, type StaffDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { roleLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateStaff, useUpdateStaff } from '../hooks';

const baseFields = {
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().max(20, 'Too long').or(z.literal('')).optional(),
  role: z.enum(ROLES as [Role, ...Role[]]),
};
// Password rule mirrors the backend (staffPassword): ≥8 chars, a letter and a number.
const createSchema = z.object({
  ...baseFields,
  email: z.string().trim().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/\d/, 'Include a number'),
});
const editSchema = z.object(baseFields);

type FormValues = z.infer<typeof createSchema>; // superset; edit mode renders/validates only base fields

export function StaffFormDialog({
  open,
  onOpenChange,
  staff,
  /** OWNER cannot demote themselves — disable the role field when editing the current user. */
  disableRole = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staff?: StaffDto;
  disableRole?: boolean;
}): JSX.Element {
  const isEdit = Boolean(staff);
  const create = useCreateStaff();
  const update = useUpdateStaff(staff?.id ?? '');

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // Edit validates a subset; the cast is safe because email/password are never rendered or sent when editing.
    resolver: zodResolver(isEdit ? editSchema : createSchema) as Resolver<FormValues>,
    defaultValues: {
      name: staff?.name ?? '',
      phone: staff?.phone ?? '',
      role: staff?.role ?? Role.SALES_EXECUTIVE,
      email: '',
      password: '',
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      if (isEdit) {
        await update.mutateAsync({ name: v.name, phone: v.phone ? v.phone : null, role: v.role });
        toast.success('Staff updated');
      } else {
        await create.mutateAsync({
          name: v.name,
          email: v.email,
          phone: v.phone || undefined,
          role: v.role,
          password: v.password,
        });
        // The temporary password is never displayed again or stored — the owner shares it out of band.
        toast.success('Staff created — share the temporary password securely with them.');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save staff member'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit staff member' : 'Add staff member'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the name, phone or role. Email cannot be changed.'
              : 'Create a staff account with a temporary password.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" error={errors.name?.message}>
            <Input {...register('name')} autoComplete="off" />
          </Field>
          {isEdit ? (
            <Field label="Email">
              <Input value={staff?.email ?? ''} disabled readOnly />
            </Field>
          ) : (
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="off" {...register('email')} />
            </Field>
          )}
          <Field label="Phone (optional)" error={errors.phone?.message}>
            <Input inputMode="tel" autoComplete="off" {...register('phone')} />
          </Field>
          <Field label="Role" error={errors.role?.message}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={disableRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {disableRole && <p className="text-xs text-muted-foreground">You can't change your own role.</p>}
          </Field>
          {!isEdit && (
            <Field label="Temporary password" error={errors.password?.message} className="sm:col-span-2">
              {/* new-password prevents browsers/managers from auto-filling or saving this one-time value */}
              <Input type="password" autoComplete="new-password" {...register('password')} />
              <p className="text-xs text-muted-foreground">
                At least 8 characters with a letter and a number. Share it securely — it is not shown again.
              </p>
            </Field>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create staff'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
