import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('tokenStore', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('keeps the access token in memory only; the refresh token survives a reload', async () => {
    const { tokenStore } = await import('./token-store');
    tokenStore.set('access-1', 'refresh-1');
    expect(tokenStore.getAccess()).toBe('access-1');
    expect(Object.values({ ...localStorage })).not.toContain('access-1');
    expect(localStorage.getItem('azad.refreshToken')).toBe('refresh-1');

    vi.resetModules(); // a reload: module state is gone, storage is not
    const reloaded = (await import('./token-store')).tokenStore;
    expect(reloaded.getAccess()).toBeNull();
    expect(reloaded.getRefresh()).toBe('refresh-1');
  });

  it('removes an access token left in storage by an earlier version', async () => {
    localStorage.setItem('azad.accessToken', 'old');
    await import('./token-store');
    expect(localStorage.getItem('azad.accessToken')).toBeNull();
  });

  it('clear() ends the session', async () => {
    const { tokenStore } = await import('./token-store');
    tokenStore.set('a', 'r');
    tokenStore.clear();
    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
  });
});
