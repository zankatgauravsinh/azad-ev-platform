import { cn } from '@/lib/utils';

/**
 * The AZAD EV brand mark — the lion-shield logo. Rendered from the bundled asset
 * so every in-app usage (nav/login/etc.) shows the approved artwork.
 */
export function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <img
      src="/logo-mark.png"
      alt="AZAD EV"
      // The artwork is dark navy: on a dark theme it sits on a light tile so it stays legible.
      className={cn('h-8 w-8 object-contain dark:rounded-md dark:bg-white dark:p-0.5', className)}
    />
  );
}
