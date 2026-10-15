import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { FieldIdContext } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

/**
 * A labelled form control. The label is tied to the Input / Textarea / SelectTrigger inside it (see
 * FieldIdContext), so screen readers announce the field by its label; an error is shown under it. To give the
 * control a known id (tests, deep links), pass `id` here — not on the control, or the label loses it.
 */
export function FormField({ label, error, className, id: fixedId, children }: { label: React.ReactNode; error?: string | null; className?: string; id?: string; children: React.ReactNode }): JSX.Element {
  const generated = useId();
  const id = fixedId ?? generated;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
