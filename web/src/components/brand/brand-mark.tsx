import { cn } from '@/lib/utils';

/**
 * "The Point Mark" — a map-pin (Azad Navy) with a knockout "A" (Azad Teal).
 * Simplified vector of the approved logo for in-app use (favicon/nav/login).
 */
export function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} role="img" aria-label="AZAD EV POINT">
      <path
        d="M32 3c-13.3 0-24 10.5-24 23.5C8 41 26 58 30.2 61.4a3 3 0 0 0 3.6 0C38 58 56 41 56 26.5 56 13.5 45.3 3 32 3Z"
        fill="#0B2545"
      />
      <path
        d="M32 13 20.5 39h6.2l2.2-5.2h6.2l2.2 5.2h6.2L32 13Zm-1.9 15.2L32 23l1.9 5.2h-3.8Z"
        fill="#00B8A9"
      />
    </svg>
  );
}
