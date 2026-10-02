import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import type { StaffDto } from '@azad/shared';
import { ResetPasswordDialog } from './reset-password-dialog';

const resetMutate = vi.fn();
vi.mock('../hooks', () => ({ useResetStaffPassword: () => ({ mutateAsync: resetMutate }) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

const input = (name: string): HTMLInputElement => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fill = (name: string, value: string): void => {
  fireEvent.change(input(name), { target: { value } });
};
const submit = (): HTMLElement => screen.getByRole('button', { name: /Reset password/ });

const staff: StaffDto = {
  id: 's2',
  name: 'Ravi',
  email: 'ravi@azadev.in',
  phone: null,
  role: 'MANAGER' as StaffDto['role'],
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PW = 'Secret123';

beforeEach(() => {
  resetMutate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe('ResetPasswordDialog', () => {
  it('validates password strength and blocks submit', async () => {
    render(<ResetPasswordDialog open onOpenChange={() => {}} staff={staff} />);
    fireEvent.click(submit());
    expect(await screen.findByText('At least 8 characters')).toBeInTheDocument();
    expect(resetMutate).not.toHaveBeenCalled();
  });

  it('requires the confirmation to match', async () => {
    render(<ResetPasswordDialog open onOpenChange={() => {}} staff={staff} />);
    fill('password', PW);
    fill('confirm', 'Secret124');
    fireEvent.click(submit());
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(resetMutate).not.toHaveBeenCalled();
  });

  it('resets the password and shows a generic confirmation (never the password)', async () => {
    const onOpenChange = vi.fn();
    resetMutate.mockResolvedValue({ id: 's2' });
    render(<ResetPasswordDialog open onOpenChange={onOpenChange} staff={staff} />);
    fill('password', PW);
    fill('confirm', PW);
    fireEvent.click(submit());
    await waitFor(() => expect(resetMutate).toHaveBeenCalledWith({ id: 's2', password: PW }));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]![0]).not.toContain(PW); // toast never contains the password
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces an API error via a toast and keeps the dialog open', async () => {
    const onOpenChange = vi.fn();
    resetMutate.mockRejectedValue(
      new AxiosError('Bad', 'ERR', undefined, undefined, { status: 400, data: { message: 'Invalid' } } as never),
    );
    render(<ResetPasswordDialog open onOpenChange={onOpenChange} staff={staff} />);
    fill('password', PW);
    fill('confirm', PW);
    fireEvent.click(submit());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Invalid'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables submit while pending and prevents duplicate submissions', async () => {
    resetMutate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ResetPasswordDialog open onOpenChange={() => {}} staff={staff} />);
    fill('password', PW);
    fill('confirm', PW);
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resetting…' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Resetting…' })); // second click ignored
    expect(resetMutate).toHaveBeenCalledTimes(1);
  });

  it('never persists the password and never leaks credential fields', async () => {
    resetMutate.mockResolvedValue({ id: 's2' });
    render(<ResetPasswordDialog open onOpenChange={() => {}} staff={staff} />);
    expect(input('password').getAttribute('autocomplete')).toBe('new-password');
    expect(input('confirm').getAttribute('autocomplete')).toBe('new-password');
    fill('password', PW);
    fill('confirm', PW);
    fireEvent.click(submit());
    await waitFor(() => expect(resetMutate).toHaveBeenCalled());
    expect(JSON.stringify(localStorage)).not.toContain(PW);
    expect(JSON.stringify(sessionStorage)).not.toContain(PW);
    // The password is never rendered as visible text, and no credential field names appear.
    expect(document.body.textContent).not.toContain(PW);
    expect(document.body.textContent).not.toContain('passwordHash');
    expect(document.body.textContent).not.toContain('refreshTokenHash');
  });
});
