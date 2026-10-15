import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiError, LoginResponse } from '@azad/shared';
import { tokenStore } from './token-store';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const apiClient = axios.create({ baseURL });

/** Attach the access token to every request. */
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ── Single-flight refresh on 401 ──────────────────────────
let refreshing: Promise<string | null> | null = null;

async function refreshOnce(): Promise<string | null> {
  // Read inside the lock: another tab may have rotated the refresh token while this one waited.
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<LoginResponse>(`${baseURL}/auth/refresh`, { refreshToken });
    tokenStore.set(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    tokenStore.clear();
    return null;
  }
}

/**
 * Trade the refresh token for a new pair. Each refresh rotates the token and the server keeps only the latest,
 * so tabs refreshing at the same moment would invalidate each other: a cross-tab lock runs them one at a time.
 */
async function refreshAccessToken(): Promise<string | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('azad-token-refresh', refreshOnce) : refreshOnce();
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const newToken = await refreshing;
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return apiClient(original);
      }
      // Refresh failed → force re-login.
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);

/** Extracts a human-friendly message from an API error. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiError | undefined;
    if (data?.message) return data.message;
    if (error.message) return error.message;
  }
  return fallback;
}

/**
 * Field-level messages from a 400 "Validation failed" response ({ details: [{ path, message }] }), keyed
 * by field path (first message per field). Empty for any other error.
 */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};
  const details = (error.response?.data as ApiError | undefined)?.details;
  if (!Array.isArray(details)) return {};
  const out: Record<string, string> = {};
  for (const d of details as { path?: unknown; message?: unknown }[]) {
    if (typeof d?.path === 'string' && typeof d.message === 'string' && !(d.path in out)) out[d.path] = d.message;
  }
  return out;
}

/** Reads a Blob as text (FileReader keeps this working where Blob.text() is unavailable). */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });
}

/**
 * Like apiErrorMessage, for requests made with `responseType: 'blob'` (PDF and file downloads): the
 * server's JSON error body arrives wrapped in a Blob, so it is read and parsed first. A Blob that is
 * not the API's error shape gives `fallback` — never a raw transport message.
 */
export async function apiErrorMessageAsync(error: unknown, fallback = 'Something went wrong'): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await blobText(error.response.data)) as Partial<ApiError> | null;
      if (parsed && typeof parsed.message === 'string' && parsed.message) return parsed.message;
    } catch {
      // not JSON — fall through to the fallback
    }
    return fallback;
  }
  return apiErrorMessage(error, fallback);
}
