import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from '@/features/dashboard/components/global-search';
import { NotificationBell } from '@/features/notifications/components/notification-bell';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function AppShell(): JSX.Element {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Android hardware back button closes the drawer when it's open (see lib/native).
  useEffect(() => {
    const close = (): void => setMobileOpen(false);
    window.addEventListener('android-back', close);
    return () => window.removeEventListener('android-back', close);
  }, []);

  if (!user) return <Outlet />;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar role={user.role} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" data-mobile-drawer="open">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="pt-safe absolute left-0 top-0 h-full w-64 border-r bg-card shadow-xl">
            <Sidebar role={user.role} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex min-h-[3.5rem] items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <GlobalSearch />
          <div className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="flex-1 p-4 md:p-8">
          <div className="pb-safe mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
