import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Header widgets are gated by effective permissions (search.use / notifications.use). Mock the heavy
// children + auth so we test only the app-shell gating decision.
const h = vi.hoisted((): { can: (p: string) => boolean } => ({ can: () => true }));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'MANAGER', permissions: [] }, can: h.can }),
}));
vi.mock('@/features/dashboard/components/global-search', () => ({ GlobalSearch: () => <div data-testid="global-search" /> }));
vi.mock('@/features/notifications/components/notification-bell', () => ({ NotificationBell: () => <div data-testid="notification-bell" /> }));
vi.mock('./sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./theme-toggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }));
vi.mock('./user-menu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));

import { AppShell } from './app-shell';

const renderShell = (): void => {
  render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
};

describe('AppShell header permission gating', () => {
  beforeEach(() => {
    h.can = () => true;
  });

  it('shows Search + Notifications when the user has search.use and notifications.use', () => {
    h.can = (p) => p === 'search.use' || p === 'notifications.use';
    renderShell();
    expect(screen.getByTestId('global-search')).toBeInTheDocument();
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('hides both for a user with neither permission (e.g. ACCOUNTANT)', () => {
    h.can = () => false;
    renderShell();
    expect(screen.queryByTestId('global-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-bell')).not.toBeInTheDocument();
  });

  it('shows Notifications but not Search for a user with only notifications.use (e.g. TECHNICIAN)', () => {
    h.can = (p) => p === 'notifications.use';
    renderShell();
    expect(screen.queryByTestId('global-search')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });
});
