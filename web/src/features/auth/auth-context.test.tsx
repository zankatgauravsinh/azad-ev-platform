import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MeResponse } from '@azad/shared';
import { AuthProvider, useAuth, useCan } from './auth-context';

const h = vi.hoisted(() => ({ access: 'tok' as string | null, me: vi.fn() }));

vi.mock('./api', () => ({
  authApi: { me: h.me, login: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/lib/token-store', () => ({
  tokenStore: { getAccess: () => h.access, getRefresh: () => null, set: vi.fn(), clear: vi.fn() },
}));

const meResponse = (permissions: string[]): MeResponse => ({
  id: 'u1', name: 'User', email: 'u@x.in', phone: null, role: 'MANAGER' as MeResponse['role'],
  isActive: true, companyId: 'c1', permissions,
});

function Probe(): JSX.Element {
  const { status, can, refreshUser, user } = useAuth();
  const viaHook = useCan('customers.view');
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="view">{String(can('customers.view'))}</span>
      <span data-testid="view-hook">{String(viaHook)}</span>
      <span data-testid="missing">{String(can('nope.nope'))}</span>
      <span data-testid="count">{user?.permissions.length ?? -1}</span>
      <button type="button" onClick={() => void refreshUser()}>refresh</button>
    </div>
  );
}

const renderProbe = (): void => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
};

beforeEach(() => {
  h.access = 'tok';
  h.me.mockReset();
});

describe('auth can()', () => {
  it('returns true for held permissions and false for missing/unknown ones', async () => {
    h.me.mockResolvedValue(meResponse(['customers.view', 'bookings.view']));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('view').textContent).toBe('true');
    expect(screen.getByTestId('view-hook').textContent).toBe('true'); // useCan hook agrees
    expect(screen.getByTestId('missing').textContent).toBe('false');
  });

  it('supports a large (OWNER-like) permission list', async () => {
    h.me.mockResolvedValue(meResponse(['customers.view', 'staff.manage', 'roles.manage', 'inventory.export']));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('count').textContent).toBe('4');
    expect(screen.getByTestId('view').textContent).toBe('true');
  });

  it('returns false for everything when unauthenticated (no user)', async () => {
    h.access = null; // no token → me() never called
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(screen.getByTestId('view').textContent).toBe('false');
    expect(screen.getByTestId('missing').textContent).toBe('false');
    expect(h.me).not.toHaveBeenCalled();
  });

  it('reflects permission-list changes after refresh', async () => {
    h.me.mockResolvedValueOnce(meResponse([])).mockResolvedValueOnce(meResponse(['customers.view']));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('view').textContent).toBe('false'); // initially no permissions
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('true')); // updated after refresh
  });
});
