/**
 * Session tokens. The short-lived access token is held in memory only, so a script injected into the page cannot
 * lift it out of storage; it is gone on reload, and the first request then trades the refresh token for a new
 * one (see api-client). The refresh token stays in localStorage so a session survives reloads and new tabs.
 * (Moving it to an httpOnly cookie needs the API served same-site over HTTPS — a deployment change.)
 */
const REFRESH_KEY = 'azad.refreshToken';
/** Where earlier versions kept the access token; removed so none is left behind in storage. */
const LEGACY_ACCESS_KEY = 'azad.accessToken';

let accessToken: string | null = null;

const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable: the session lasts until reload */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* nothing stored */ }
  },
};

storage.remove(LEGACY_ACCESS_KEY);

export const tokenStore = {
  getAccess(): string | null {
    return accessToken;
  },
  getRefresh(): string | null {
    return storage.get(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    accessToken = access;
    storage.set(REFRESH_KEY, refresh);
  },
  clear(): void {
    accessToken = null;
    storage.remove(REFRESH_KEY);
  },
};
