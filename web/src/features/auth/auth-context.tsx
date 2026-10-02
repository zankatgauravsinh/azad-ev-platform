import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LoginInput, MeResponse } from '@azad/shared';
import { tokenStore } from '@/lib/token-store';
import { authApi } from './api';

interface AuthContextValue {
  user: MeResponse | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (input: LoginInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /**
   * UX-only effective-permission check against the user's keys from /auth/me. NOT a security
   * boundary — the backend authorizes every request. Returns false when unauthenticated.
   */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  const loadUser = useCallback(async () => {
    if (!tokenStore.getAccess()) {
      setUser(null);
      setStatus('unauthenticated');
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
      setStatus('authenticated');
    } catch {
      tokenStore.clear();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = useCallback(async (input: LoginInput): Promise<MeResponse> => {
    const result = await authApi.login(input);
    tokenStore.set(result.accessToken, result.refreshToken);
    // Fetch /auth/me so the session carries effective permission keys (login response has none).
    const me = await authApi.me();
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      tokenStore.clear();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const can = useCallback((permission: string): boolean => (user?.permissions ?? []).includes(permission), [user]);

  const value = useMemo(
    () => ({ user, status, login, logout, refreshUser: loadUser, can }),
    [user, status, login, logout, loadUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Convenience hook: `useCan('inventory.update')`. UX-only — backend remains authoritative. */
export function useCan(permission: string): boolean {
  return useAuth().can(permission);
}
