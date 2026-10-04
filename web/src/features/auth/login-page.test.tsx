import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MeResponse } from '@azad/shared';

/**
 * Login landing is intentionally permission-driven: dashboard-capable users (effective permission
 * dashboard.view) land on /dashboard, everyone else on Home — regardless of legacy role name.
 */
const h = vi.hoisted(() => ({ navigate: vi.fn(), login: vi.fn() }));

vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('./auth-context', () => ({ useAuth: () => ({ login: h.login }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { LoginPage } from './login-page';

const me = (role: MeResponse['role'], permissions: string[]): MeResponse => ({
  id: 'u1', name: 'U', email: 'u@x.in', phone: null, role, isActive: true, companyId: 'c1', permissions,
});

const landOf = async (user: MeResponse): Promise<string> => {
  cleanup(); // isolate repeated renders within a single test
  h.navigate.mockReset();
  h.login.mockResolvedValue(user);
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@azadev.in' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  const [path] = h.navigate.mock.calls.at(-1)!;
  return path as string;
};

describe('Login landing is permission-driven', () => {
  beforeEach(() => {
    h.navigate.mockReset();
    h.login.mockReset();
  });

  it('OWNER with dashboard.view → /dashboard', async () => {
    expect(await landOf(me('OWNER', ['dashboard.view']))).toBe('/dashboard');
  });

  it('MANAGER with dashboard.view → /dashboard', async () => {
    expect(await landOf(me('MANAGER', ['dashboard.view', 'inventory.view']))).toBe('/dashboard');
  });

  it('SALES / TECHNICIAN / ACCOUNTANT without dashboard.view → /', async () => {
    expect(await landOf(me('SALES_EXECUTIVE', ['customers.view']))).toBe('/');
    expect(await landOf(me('TECHNICIAN', ['service.workflow']))).toBe('/');
    expect(await landOf(me('ACCOUNTANT', ['finance.manage']))).toBe('/');
  });

  it('a custom role WITH dashboard.view → /dashboard (permission, not role name)', async () => {
    // Legacy enum TECHNICIAN would land on Home, but the custom role grants dashboard.view.
    expect(await landOf(me('TECHNICIAN', ['dashboard.view']))).toBe('/dashboard');
  });

  it('a custom role WITHOUT dashboard.view → / (even if enum is MANAGER)', async () => {
    expect(await landOf(me('MANAGER', ['customers.view']))).toBe('/');
  });
});
