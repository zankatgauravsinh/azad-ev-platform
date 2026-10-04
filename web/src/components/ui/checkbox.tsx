import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal, dependency-free checkbox (mirrors the Switch primitive's controlled API). Renders an
 * accessible button with role="checkbox" so it is keyboard- and screen-reader-friendly and easily
 * targeted in tests via getByRole('checkbox').
 */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-accent bg-accent text-accent-foreground' : 'border-input bg-background',
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
}
