import { NavLink } from 'react-router-dom';
import type { Role } from '@azad/shared';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand/brand-mark';
import { useBranding } from '@/features/settings/hooks';
import { visibleNavItems } from './nav-items';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/api\/v1$/, '');

export function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }): JSX.Element {
  const items = visibleNavItems(role);
  const { data: branding } = useBranding();
  const logoSrc = branding?.companyLogoUrl
    ? branding.companyLogoUrl.startsWith('http') ? branding.companyLogoUrl : `${API_ORIGIN}${branding.companyLogoUrl}`
    : null;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 px-4 py-4">
        {logoSrc ? (
          <img src={logoSrc} alt="Logo" className="h-8 w-8 rounded object-contain" />
        ) : (
          <BrandMark className="h-8 w-8" />
        )}
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight">{branding?.businessName ?? 'AZAD EV POINT'}</p>
          <p className="text-[11px] text-muted-foreground">Showroom</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          if (!item.enabled) {
            return (
              <div
                key={item.to}
                aria-disabled
                title="Coming soon"
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/50"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Soon
                </span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/80 hover:bg-secondary hover:text-secondary-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <p className="px-4 py-3 text-[11px] text-muted-foreground">Ride Free. Ride Electric.</p>
    </div>
  );
}
