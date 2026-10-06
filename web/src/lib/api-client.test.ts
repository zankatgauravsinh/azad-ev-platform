import { AxiosError, type AxiosResponse } from 'axios';
import { describe, it, expect } from 'vitest';
import { apiErrorMessage, apiErrorMessageAsync } from './api-client';

const axiosError = (data: unknown, status = 403): AxiosError =>
  new AxiosError('Request failed with status code ' + status, 'ERR_BAD_REQUEST', undefined, undefined, { status, data, headers: {}, config: {} } as unknown as AxiosResponse);
const blobOf = (text: string, type = 'application/json'): Blob => new Blob([text], { type });

describe('apiErrorMessageAsync', () => {
  it('reads the server message out of a JSON error body that arrived as a Blob', async () => {
    const e = axiosError(blobOf(JSON.stringify({ statusCode: 403, error: 'Forbidden', message: 'Forbidden resource', path: '/x' })));
    await expect(apiErrorMessageAsync(e)).resolves.toBe('Forbidden resource');
    await expect(apiErrorMessageAsync(axiosError(blobOf(JSON.stringify({ message: 'Vehicle has not been delivered yet' })), 400))).resolves.toBe('Vehicle has not been delivered yet');
  });

  it('falls back safely for a Blob that is not the API error shape — never the raw transport message', async () => {
    await expect(apiErrorMessageAsync(axiosError(blobOf('%PDF-1.3 garbage', 'application/pdf'), 500), 'Could not download')).resolves.toBe('Could not download');
    await expect(apiErrorMessageAsync(axiosError(blobOf('{"statusCode":500}'), 500))).resolves.toBe('Something went wrong');
    await expect(apiErrorMessageAsync(axiosError(blobOf('null'), 500))).resolves.toBe('Something went wrong');
    const fallback = await apiErrorMessageAsync(axiosError(blobOf('not json'), 500));
    expect(fallback).not.toContain('status code');
  });

  it('behaves exactly like apiErrorMessage for non-Blob errors', async () => {
    const json = axiosError({ message: 'Booking not found' }, 404);
    await expect(apiErrorMessageAsync(json)).resolves.toBe(apiErrorMessage(json));
    await expect(apiErrorMessageAsync(new Error('boom'))).resolves.toBe('Something went wrong');
    await expect(apiErrorMessageAsync(undefined, 'Fallback')).resolves.toBe('Fallback');
  });
});
