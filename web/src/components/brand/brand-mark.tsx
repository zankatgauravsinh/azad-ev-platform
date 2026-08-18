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
      className={cn('h-8 w-8 object-contain', className)}
    />
  );
}
