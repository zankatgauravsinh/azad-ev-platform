import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GstReadinessDto } from '@azad/shared';
import { GstReadinessCard, GstRegistrationCard } from './gst-registration-card';

// Synthetic, well-formed GSTIN-shaped placeholder — not a real registration.
const GSTIN = '24AAAAA0000A1Z5';

const h = vi.hoisted(() => ({
  settings: { current: null as Record<string, unknown> | null },
  readiness: { current: null as unknown },
  update: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/features/settings/hooks', () => ({
  useCompanySettings: () => ({ data: h.settings.current, isLoading: false }),
  useUpdateSettings: () => ({ mutateAsync: h.update, isPending: false }),
}));
vi.mock('../hooks', () => ({ useGstReadiness: () => ({ data: h.readiness.current, isLoading: false }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const settings = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ gstEnabled: false, gstNumber: null, gstStateCode: null, ...over });
const enableBox = () => screen.getByRole('checkbox', { name: 'GST enabled' }) as HTMLInputElement;
const gstin = () => screen.getByLabelText('GSTIN') as HTMLInputElement;
const stateCode = () => screen.getByLabelText('GST state code') as HTMLInputElement;
const saveBtn = () => screen.queryByRole('button', { name: 'Save registration' });

beforeEach(() => {
  h.settings.current = settings();
  h.update.mockReset().mockResolvedValue({});
  h.invalidate.mockReset();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('GstRegistrationCard', () => {
  it('shows GST as disabled by default with nothing pre-filled', () => {
    render(<GstRegistrationCard canManage />);
    expect(screen.getByText('GST disabled')).toBeInTheDocument();
    expect(enableBox().checked).toBe(false);
    expect(gstin().value).toBe('');
    expect(stateCode().value).toBe('');
    expect(saveBtn()).toBeDisabled(); // nothing changed yet
  });

  it('is read-only without settings.manage: no Save, fields disabled', () => {
    h.settings.current = settings({ gstEnabled: true, gstNumber: GSTIN, gstStateCode: '24' });
    render(<GstRegistrationCard canManage={false} />);
    expect(screen.getByText('GST enabled')).toBeInTheDocument();
    expect(saveBtn()).toBeNull();
    expect(enableBox()).toBeDisabled();
    expect(gstin()).toBeDisabled();
    expect(stateCode()).toBeDisabled();
  });

  it('explains why GST cannot be enabled and blocks the save until the registration is complete', () => {
    render(<GstRegistrationCard canManage />);
    fireEvent.click(enableBox());
    expect(screen.getByRole('alert')).toHaveTextContent('the company GSTIN is not set');
    expect(screen.getByRole('alert')).toHaveTextContent('the company GST state code is not set');
    expect(saveBtn()).toBeDisabled();

    fireEvent.change(gstin(), { target: { value: 'not-a-gstin' } });
    expect(screen.getByRole('alert')).toHaveTextContent('not a well-formed');
    fireEvent.change(gstin(), { target: { value: GSTIN } });
    fireEvent.change(stateCode(), { target: { value: '27' } });
    expect(screen.getByRole('alert')).toHaveTextContent('does not match the first two digits');
    expect(saveBtn()).toBeDisabled();

    fireEvent.change(stateCode(), { target: { value: '24' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('enables GST: sends the three registration fields (GSTIN upper-cased) and refreshes readiness', async () => {
    render(<GstRegistrationCard canManage />);
    fireEvent.click(enableBox());
    fireEvent.change(gstin(), { target: { value: GSTIN.toLowerCase() } });
    fireEvent.change(stateCode(), { target: { value: '24' } });
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstEnabled: true, gstNumber: GSTIN, gstStateCode: '24' }));
    await waitFor(() => expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['tax', 'readiness'] }));
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('disables GST without requiring any registration detail', async () => {
    h.settings.current = settings({ gstEnabled: true, gstNumber: GSTIN, gstStateCode: '24' });
    render(<GstRegistrationCard canManage />);
    fireEvent.click(enableBox());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstEnabled: false, gstNumber: GSTIN, gstStateCode: '24' }));
  });

  it('surfaces a backend refusal and keeps the user’s input', async () => {
    h.update.mockRejectedValueOnce(new Error('GST cannot be enabled: the company GSTIN is not set'));
    h.settings.current = settings({ gstNumber: GSTIN, gstStateCode: '24' });
    render(<GstRegistrationCard canManage />);
    fireEvent.click(enableBox());
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(enableBox().checked).toBe(true);
  });

  it('keeps registration details out of browser storage', async () => {
    render(<GstRegistrationCard canManage />);
    fireEvent.click(enableBox());
    fireEvent.change(gstin(), { target: { value: GSTIN } });
    fireEvent.change(stateCode(), { target: { value: '24' } });
    fireEvent.click(saveBtn()!);
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(JSON.stringify(localStorage)).not.toContain(GSTIN);
    expect(JSON.stringify(sessionStorage)).not.toContain(GSTIN);
  });
});

describe('GstReadinessCard', () => {
  const readiness = (over: Partial<GstReadinessDto> = {}): GstReadinessDto => ({
    gstEnabled: false,
    registration: { gstinPresent: false, gstinWellFormed: false, stateCodePresent: false, stateCodeValid: false, stateCodeMatchesGstin: null },
    canEnable: false,
    blockers: ['the company GSTIN is not set'],
    discountTreatment: null,
    exchangeTreatment: null,
    componentMappings: [
      { component: 'EXTENDED_WARRANTY', classification: null, usable: false },
      { component: 'RTO', classification: null, usable: false },
      { component: 'INSURANCE', classification: null, usable: false },
      { component: 'REGISTRATION', classification: null, usable: false },
    ],
    classifications: { active: 0, taxableWithoutCurrentRate: 0 },
    scooterModels: { total: 0, classified: 0, missing: 0 },
    accessories: { total: 0, classified: 0, missing: 0 },
    ...over,
  });

  it('shows everything as "not configured" without treating unused items as errors', () => {
    h.readiness.current = readiness();
    render(<GstReadinessCard />);
    expect(screen.getByText('Company GST registration')).toBeInTheDocument();
    expect(screen.getAllByText(/Not configured/).length).toBe(4); // registration, state, discount, exchange
    expect(screen.getAllByText(/Not mapped/).length).toBe(4);
    expect(screen.getByText('No scooter models yet')).toBeInTheDocument();
    expect(screen.getByText('No accessories yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/A guide only/)).toBeInTheDocument();
  });

  it('shows configured policies, mapped components and product counts', () => {
    h.readiness.current = readiness({
      gstEnabled: true,
      canEnable: true,
      blockers: [],
      registration: { gstinPresent: true, gstinWellFormed: true, stateCodePresent: true, stateCodeValid: true, stateCodeMatchesGstin: true },
      discountTreatment: 'AFTER_TAX_ADJUSTMENT',
      exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE',
      componentMappings: [
        { component: 'EXTENDED_WARRANTY', classification: null, usable: false },
        { component: 'RTO', classification: { id: 'c1', name: 'Test RTO class', codeType: 'SAC', code: null, treatment: 'NON_TAXABLE' }, usable: true },
        { component: 'INSURANCE', classification: { id: 'c2', name: 'Old class', codeType: 'SAC', code: null, treatment: 'EXEMPT' }, usable: false },
        { component: 'REGISTRATION', classification: null, usable: false },
      ],
      classifications: { active: 5, taxableWithoutCurrentRate: 1 },
      scooterModels: { total: 12, classified: 10, missing: 2 },
      accessories: { total: 8, classified: 5, missing: 3 },
    });
    render(<GstReadinessCard />);
    expect(screen.getByText(/After-tax adjustment/)).toBeInTheDocument();
    expect(screen.getByText(/Reduces vehicle taxable value/)).toBeInTheDocument();
    expect(screen.getByText(/Test RTO class/)).toBeInTheDocument();
    expect(screen.getByText(/Old class \(inactive\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Not mapped/).length).toBe(2);
    expect(screen.getByText('12 scooter models · 10 classified · 2 missing')).toBeInTheDocument();
    expect(screen.getByText('8 accessories · 5 classified · 3 missing')).toBeInTheDocument();
    expect(screen.getByText(/5 active · 1 taxable without a rate for today/)).toBeInTheDocument();
  });
});
