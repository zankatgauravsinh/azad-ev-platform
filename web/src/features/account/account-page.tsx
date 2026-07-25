import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { authApi } from '@/features/auth/api';
import { apiErrorMessage } from '@/lib/api-client';
import { roleLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AccountPage(): JSX.Element {
  const { user } = useAuth();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current: '', next: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await authApi.changePassword(values);
      toast.success('Password updated');
      reset();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not update password'));
    }
  });

  if (!user) return <></>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">
          The showroom dashboard is being built module by module. Your account is ready.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Phone" value={user.phone ?? '—'} />
            <Row label="Role" value={roleLabel(user.role)} />
            <Row label="Status" value={user.isActive ? 'Active' : 'Inactive'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Use at least 8 characters with a letter and a number</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" autoComplete="current-password" {...register('current')} />
                {errors.current && <p className="text-xs text-destructive">{errors.current.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="next">New password</Label>
                <Input id="next" type="password" autoComplete="new-password" {...register('next')} />
                {errors.next && <p className="text-xs text-destructive">{errors.next.message}</p>}
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
