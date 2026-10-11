import { useEffect, useState } from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { IDENTIFICATION_CORRECTION_REASON_MIN, type IdentificationCorrectionInput } from '@azad/shared';
import { apiErrorMessage, apiFieldErrors } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCorrectIdentification } from '../hooks';
import type { UnitDetail } from '../api';

const FIELDS = [
  { key: 'vin', label: 'VIN', min: 3 },
  { key: 'motorNumber', label: 'Motor number', min: 1 },
  { key: 'batteryNumber', label: 'Battery number', min: 1 },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];
type Values = Record<FieldKey, string> & { reason: string };
type Errors = Partial<Record<FieldKey | 'reason' | 'form', string>>;

const normalise = (value: string): string => value.trim().toUpperCase();

/**
 * OWNER-only correction of a vehicle's VIN / motor / battery number (M4B.3). The fields start with the
 * current values; changed ones are highlighted; a reason is required; the old → new summary must be
 * confirmed. Only the changed fields and the reason are sent. Only the vehicle record changes — bookings,
 * sales, warranties, documents and GST records keep what they recorded.
 */
export function IdentificationCorrectionDialog({ open, onOpenChange, unit }: { open: boolean; onOpenChange: (open: boolean) => void; unit: UnitDetail }): JSX.Element {
  const correct = useCorrectIdentification(unit.id);
  const current: Record<FieldKey, string> = { vin: unit.vin, motorNumber: unit.motorNumber, batteryNumber: unit.batteryNumber };
  const [values, setValues] = useState<Values>({ ...current, reason: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');

  useEffect(() => {
    if (!open) return;
    setValues({ vin: unit.vin, motorNumber: unit.motorNumber, batteryNumber: unit.batteryNumber, reason: '' });
    setErrors({});
    setStep('edit');
  }, [open, unit.vin, unit.motorNumber, unit.batteryNumber]);

  const changes = FIELDS.filter((f) => normalise(values[f.key]) !== current[f.key]).map((f) => ({ ...f, from: current[f.key], to: normalise(values[f.key]) }));

  const validate = (): Errors => {
    const found: Errors = {};
    for (const f of FIELDS) if (values[f.key].trim().length < f.min) found[f.key] = f.key === 'vin' ? 'VIN is required' : 'Required';
    if (values.reason.trim().length < IDENTIFICATION_CORRECTION_REASON_MIN) found.reason = `Give a reason of at least ${IDENTIFICATION_CORRECTION_REASON_MIN} characters`;
    if (changes.length === 0) found.form = 'Change at least one number — they all match the vehicle now.';
    return found;
  };

  const review = (): void => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length === 0) setStep('confirm');
  };

  const submit = async (): Promise<void> => {
    const input: IdentificationCorrectionInput = { reason: values.reason.trim() };
    for (const c of changes) input[c.key] = c.to;
    try {
      await correct.mutateAsync(input);
      toast.success('Identification corrected');
      onOpenChange(false);
    } catch (error) {
      const fields = apiFieldErrors(error);
      const known = Object.fromEntries(Object.entries(fields).filter(([k]) => k === 'reason' || FIELDS.some((f) => f.key === k)));
      setErrors(Object.keys(known).length > 0 ? known : { form: apiErrorMessage(error, 'Could not correct the identification') });
      setStep('edit');
    }
  };

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct identification</DialogTitle>
          <DialogDescription>
            Fix a wrong VIN, motor or battery number on this vehicle. Only the vehicle record changes — its bookings, sales, warranties,
            documents and GST records keep what they recorded, and the correction is logged with your reason.
          </DialogDescription>
        </DialogHeader>

        {step === 'edit' ? (
          <div className="space-y-4">
            {errors.form && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errors.form}</p>}
            {FIELDS.map((f) => {
              const changed = normalise(values[f.key]) !== current[f.key];
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`correct-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`correct-${f.key}`}
                    className={`uppercase ${changed ? 'border-amber-500 bg-amber-500/10' : ''}`}
                    value={values[f.key]}
                    onChange={set(f.key)}
                    aria-invalid={Boolean(errors[f.key])}
                    data-changed={changed || undefined}
                  />
                  <p className="text-xs text-muted-foreground">
                    Current: <span className="font-mono">{current[f.key]}</span>
                    {changed && <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">changed</span>}
                  </p>
                  {errors[f.key] && <p className="text-xs text-destructive">{errors[f.key]}</p>}
                </div>
              );
            })}
            <div className="space-y-1.5">
              <Label htmlFor="correct-reason">Reason</Label>
              <Textarea id="correct-reason" rows={2} placeholder="e.g. VIN mistyped at stock entry" value={values.reason} onChange={set('reason')} aria-invalid={Boolean(errors.reason)} />
              {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={review}>Review correction</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Please confirm. This changes the vehicle&apos;s identification from now on; documents printed from now will show the new numbers.</span>
            </p>
            <ul aria-label="Changes" className="space-y-2 text-sm">
              {changes.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-muted-foreground">{c.label}</span>
                  <span className="font-mono line-through decoration-muted-foreground">{c.from}</span>
                  <ArrowRight className="h-4 w-4" aria-label="to" />
                  <span className="font-mono font-semibold">{c.to}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm"><span className="text-muted-foreground">Reason: </span>{values.reason.trim()}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('edit')} disabled={correct.isPending}>Back</Button>
              <Button type="button" onClick={() => void submit()} disabled={correct.isPending}>{correct.isPending ? 'Saving…' : 'Confirm correction'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
