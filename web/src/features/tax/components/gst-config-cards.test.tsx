import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import type { TaxClassificationDto, TaxComponentMappingDto } from '@azad/shared';
import { ComponentMappingCard, GstPolicyCard, ProductDefaultsCard } from './gst-config-cards';

const h = vi.hoisted(() => ({
  perms: { current: new Set<string>() },
  settings: { current: null as Record<string, unknown> | null },
  mappings: { current: [] as unknown[] },
  models: { current: [] as unknown[] },
  accessories: { current: [] as unknown[] },
  update: vi.fn(),
  setMapping: vi.fn(),
  clearMapping: vi.fn(),
  setModel: vi.fn(),
  setAccessory: vi.fn(),
  useModels: vi.fn(),
  useAccessories: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('@/features/settings/hooks', () => ({
  useCompanySettings: () => ({ data: h.settings.current, isLoading: false }),
  useUpdateSettings: () => ({ mutateAsync: h.update, isPending: false }),
}));
vi.mock('@/features/inventory/hooks', () => ({ useModels: () => h.useModels() }));
vi.mock('@/features/sales/hooks', () => ({ useAccessories: () => h.useAccessories() }));
vi.mock('../hooks', () => ({
  useComponentMappings: () => ({ data: h.mappings.current, isLoading: false }),
  useGstConfigMutations: () => ({
    setComponentMapping: { mutateAsync: h.setMapping, isPending: false },
    clearComponentMapping: { mutateAsync: h.clearMapping, isPending: false },
    setScooterModelClassification: { mutateAsync: h.setModel, isPending: false },
    setAccessoryClassification: { mutateAsync: h.setAccessory, isPending: false },
  }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
// Native <select> stand-in: the field's `name` becomes its accessible name.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { name?: string; value?: string; disabled?: boolean; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ name, value, disabled, onValueChange, children }: P) =>
      React.createElement('select', { 'aria-label': name, value, disabled, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

// Placeholder classifications — not real HSN/SAC values.
const cls = (id: string, name: string): TaxClassificationDto => ({ id, name, codeType: 'HSN', code: `TEST-${id}`, treatment: 'TAXABLE', description: null, isActive: true, createdAt: '', updatedAt: '', rates: [] });
const CLASSIFICATIONS = [cls('c1', 'Class one'), cls('c2', 'Class two')];
const unmapped = (): TaxComponentMappingDto[] => [
  { component: 'EXTENDED_WARRANTY', classification: null, usable: false },
  { component: 'RTO', classification: null, usable: false },
  { component: 'INSURANCE', classification: null, usable: false },
  { component: 'REGISTRATION', classification: null, usable: false },
];
const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const optionTexts = (el: HTMLSelectElement): string[] => [...el.options].map((o) => o.textContent ?? '');

beforeEach(() => {
  h.perms.current = new Set();
  h.settings.current = { gstDiscountTreatment: null, gstExchangeTreatment: null };
  h.mappings.current = unmapped();
  h.models.current = [];
  h.accessories.current = [];
  for (const f of [h.update, h.setMapping, h.clearMapping, h.setModel, h.setAccessory]) f.mockReset().mockResolvedValue({});
  h.useModels.mockReset().mockImplementation(() => ({ data: h.models.current, isLoading: false }));
  h.useAccessories.mockReset().mockImplementation(() => ({ data: h.accessories.current, isLoading: false }));
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});
afterEach(cleanup);

describe('GstPolicyCard', () => {
  it('shows both policies as "Not configured" — no default is selected', () => {
    render(<GstPolicyCard canManage />);
    expect(select('discount-treatment').value).toBe('__none__');
    expect(select('exchange-treatment').value).toBe('__none__');
    expect(optionTexts(select('discount-treatment'))).toEqual(['Not configured', 'Reduces vehicle taxable value', 'After-tax adjustment']);
    expect(optionTexts(select('exchange-treatment'))).toEqual(['Not configured', 'Reduces vehicle taxable value', 'After-tax adjustment']);
  });

  it('saves only the policy that was changed', async () => {
    render(<GstPolicyCard canManage />);
    fireEvent.change(select('discount-treatment'), { target: { value: 'AFTER_TAX_ADJUSTMENT' } });
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT' }));
    fireEvent.change(select('exchange-treatment'), { target: { value: 'REDUCES_VEHICLE_TAXABLE_VALUE' } });
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }));
  });

  it('can be set back to "Not configured" (sends null, never a substitute value)', async () => {
    h.settings.current = { gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' };
    render(<GstPolicyCard canManage />);
    expect(select('discount-treatment').value).toBe('AFTER_TAX_ADJUSTMENT');
    fireEvent.change(select('discount-treatment'), { target: { value: '__none__' } });
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ gstDiscountTreatment: null }));
  });

  it('is read-only without settings.manage, and surfaces a save error', async () => {
    const { unmount } = render(<GstPolicyCard canManage={false} />);
    expect(select('discount-treatment')).toBeDisabled();
    expect(select('exchange-treatment')).toBeDisabled();
    unmount();
    h.update.mockRejectedValueOnce(new Error('nope'));
    render(<GstPolicyCard canManage />);
    fireEvent.change(select('discount-treatment'), { target: { value: 'AFTER_TAX_ADJUSTMENT' } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});

describe('ComponentMappingCard', () => {
  it('lists the four components, all "Not mapped" by default', () => {
    render(<ComponentMappingCard canManage classifications={CLASSIFICATIONS} />);
    for (const label of ['Extended Warranty', 'RTO', 'Insurance', 'Registration']) expect(screen.getByText(label)).toBeInTheDocument();
    for (const c of ['EXTENDED_WARRANTY', 'RTO', 'INSURANCE', 'REGISTRATION']) expect(select(`mapping-${c}`).value).toBe('__none__');
    expect(optionTexts(select('mapping-RTO'))).toEqual(['Not mapped', 'Class one · HSN TEST-c1', 'Class two · HSN TEST-c2']);
  });

  it('assigns, replaces and clears a mapping', async () => {
    render(<ComponentMappingCard canManage classifications={CLASSIFICATIONS} />);
    fireEvent.change(select('mapping-RTO'), { target: { value: 'c1' } });
    await waitFor(() => expect(h.setMapping).toHaveBeenCalledWith({ component: 'RTO', classificationId: 'c1' }));
    cleanup();
    h.mappings.current = unmapped().map((m) => (m.component === 'RTO' ? { ...m, classification: { id: 'c1', name: 'Class one', codeType: 'HSN', code: 'TEST-c1', treatment: 'TAXABLE' }, usable: true } : m));
    render(<ComponentMappingCard canManage classifications={CLASSIFICATIONS} />);
    expect(select('mapping-RTO').value).toBe('c1');
    fireEvent.change(select('mapping-RTO'), { target: { value: 'c2' } });
    await waitFor(() => expect(h.setMapping).toHaveBeenCalledWith({ component: 'RTO', classificationId: 'c2' }));
    fireEvent.change(select('mapping-RTO'), { target: { value: '__none__' } });
    await waitFor(() => expect(h.clearMapping).toHaveBeenCalledWith('RTO'));
  });

  it('flags a mapping whose classification is no longer active, and still shows what it was', () => {
    h.mappings.current = unmapped().map((m) => (m.component === 'INSURANCE' ? { ...m, classification: { id: 'gone', name: 'Retired class', codeType: 'SAC', code: null, treatment: 'EXEMPT' }, usable: false } : m));
    render(<ComponentMappingCard canManage classifications={CLASSIFICATIONS} />);
    expect(screen.getByText('Inactive classification')).toBeInTheDocument();
    expect(select('mapping-INSURANCE').value).toBe('gone');
    expect(optionTexts(select('mapping-INSURANCE'))).toContain('Retired class (inactive)');
  });

  it('is read-only without settings.manage, and surfaces a save error', async () => {
    const { unmount } = render(<ComponentMappingCard canManage={false} classifications={CLASSIFICATIONS} />);
    expect(select('mapping-RTO')).toBeDisabled();
    unmount();
    h.setMapping.mockRejectedValueOnce(new Error('Tax classification not found'));
    render(<ComponentMappingCard canManage classifications={CLASSIFICATIONS} />);
    fireEvent.change(select('mapping-RTO'), { target: { value: 'c1' } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});

describe('ProductDefaultsCard', () => {
  beforeEach(() => {
    h.models.current = [{ id: 'm1', name: 'Model One', brand: 'TESTBRAND', taxClassificationId: null }, { id: 'm2', name: 'Model Two', brand: 'TESTBRAND', taxClassificationId: 'c2' }];
    h.accessories.current = [{ id: 'a1', name: 'Helmet', taxClassificationId: null }];
  });

  it('renders nothing — and loads nothing — for a user with neither product permission', () => {
    const { container } = render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    expect(container).toBeEmptyDOMElement();
    expect(h.useModels).not.toHaveBeenCalled();
    expect(h.useAccessories).not.toHaveBeenCalled();
  });

  it('lists models and accessories with their current classification; unclassified shows "Not classified"', () => {
    h.perms.current = new Set(['inventory.view', 'inventory.update', 'accessories.view', 'accessories.manage']);
    render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    const models = within(screen.getByRole('region', { name: 'Scooter models' }));
    expect(models.getByText('Model One')).toBeInTheDocument();
    expect(select('model-m1').value).toBe('__none__');
    expect(select('model-m2').value).toBe('c2');
    expect(optionTexts(select('model-m1'))[0]).toBe('Not classified');
    expect(within(screen.getByRole('region', { name: 'Accessories' })).getByText('Helmet')).toBeInTheDocument();
    expect(select('accessory-a1').value).toBe('__none__');
  });

  it('assigns and clears a model and an accessory classification', async () => {
    h.perms.current = new Set(['inventory.view', 'inventory.update', 'accessories.view', 'accessories.manage']);
    render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    fireEvent.change(select('model-m1'), { target: { value: 'c1' } });
    await waitFor(() => expect(h.setModel).toHaveBeenCalledWith({ modelId: 'm1', taxClassificationId: 'c1' }));
    fireEvent.change(select('model-m2'), { target: { value: '__none__' } });
    await waitFor(() => expect(h.setModel).toHaveBeenCalledWith({ modelId: 'm2', taxClassificationId: null }));
    fireEvent.change(select('accessory-a1'), { target: { value: 'c2' } });
    await waitFor(() => expect(h.setAccessory).toHaveBeenCalledWith({ accessoryId: 'a1', taxClassificationId: 'c2' }));
  });

  it('view-only product permissions: lists are shown but cannot be edited', () => {
    h.perms.current = new Set(['inventory.view', 'accessories.view']);
    render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    expect(select('model-m1')).toBeDisabled();
    expect(select('accessory-a1')).toBeDisabled();
  });

  it('shows only the section the user may see (accessories are not even requested)', () => {
    h.perms.current = new Set(['inventory.view', 'inventory.update']);
    render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    expect(screen.getByRole('region', { name: 'Scooter models' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Accessories' })).toBeNull();
    expect(h.useAccessories).not.toHaveBeenCalled();
    expect(select('model-m1')).not.toBeDisabled();
  });

  it('surfaces a backend refusal', async () => {
    h.perms.current = new Set(['inventory.view', 'inventory.update']);
    h.setModel.mockRejectedValueOnce(new Error('Tax classification "X" is inactive'));
    render(<ProductDefaultsCard classifications={CLASSIFICATIONS} />);
    fireEvent.change(select('model-m1'), { target: { value: 'c1' } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});
