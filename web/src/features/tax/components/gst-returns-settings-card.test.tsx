import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GstReturnsSettingsCard } from './gst-returns-settings-card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ update: vi.fn(), settings: { current: {} as any } }));
vi.mock('@/features/settings/hooks', () => ({
  useCompanySettings: () => ({ data: h.settings.current, isLoading: false }),
  useUpdateSettings: () => ({ mutateAsync: h.update, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  h.update.mockReset().mockResolvedValue({});
  h.settings.current = { gstEffectiveFrom: '2024-04-01', gstAatoAbove5Cr: false, serviceSacCode: '9987', servicePartsHsnCode: null, serviceGstRateBp: 1800 };
});
afterEach(cleanup);

describe('GstReturnsSettingsCard', () => {
  it('shows the stored values and saves the registration date, turnover band and service codes', async () => {
    render(<GstReturnsSettingsCard canManage />);
    expect((screen.getByLabelText('GST registration effective from') as HTMLInputElement).value).toBe('2024-04-01');
    expect((screen.getByLabelText('Default GST on service bills (%)') as HTMLInputElement).value).toBe('18');
    fireEvent.change(screen.getByLabelText('Spare parts HSN'), { target: { value: '8714' } });
    fireEvent.click(screen.getByLabelText('Turnover above 5 crore'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstEffectiveFrom: '2024-04-01', gstAatoAbove5Cr: true, serviceSacCode: '9987', servicePartsHsnCode: '8714', serviceGstRateBp: 1800 }));
  });

  it('is read-only without settings.manage', () => {
    render(<GstReturnsSettingsCard canManage={false} />);
    expect((screen.getByLabelText('Service labour SAC') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
