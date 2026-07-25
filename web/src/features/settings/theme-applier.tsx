import { useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { hexToHslTriplet } from '@/lib/color';
import { useBranding } from './hooks';

/**
 * Applies the company's brand colours (from CompanySettings) to the design-token
 * CSS variables at runtime, so branding is data-driven instead of hardcoded.
 * Renders nothing.
 */
export function ThemeApplier(): null {
  const { status } = useAuth();
  const { data } = useBranding(status === 'authenticated');

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const primary = hexToHslTriplet(data.primaryColor);
    const accent = hexToHslTriplet(data.secondaryColor);
    if (primary) root.style.setProperty('--primary', primary);
    if (accent) {
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--ring', accent);
    }
  }, [data]);

  return null;
}
