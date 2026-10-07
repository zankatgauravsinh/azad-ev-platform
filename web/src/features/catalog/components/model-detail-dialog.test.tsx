import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler, ChangeEvent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogModelDto, CatalogVariantDto } from '@azad/shared';
import { ModelDetailDialog } from './model-detail-dialog';

const h = vi.hoisted(() => ({
  perms: { current: new Set<string>() },
  model: { current: null as CatalogModelDto | null },
  variants: { current: [] as CatalogVariantDto[] },
  variantQuery: { current: null as unknown },
  setModelActive: vi.fn(), setVariantActive: vi.fn(),
  classifications: { current: [] as unknown[] },
  classificationsEnabled: { current: null as boolean | null },
  navigate: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')), useNavigate: () => h.navigate }));
vi.mock('../hooks', () => ({
  useCatalogModel: (id: string | null) => ({ data: id ? h.model.current : undefined }),
  useCatalogVariants: (modelId: string | null, status: string) => { h.variantQuery.current = { modelId, status }; return { data: modelId ? h.variants.current : undefined, isLoading: false, isFetching: false }; },
  useCatalogMutations: () => ({ setModelActive: { mutateAsync: h.setModelActive }, setVariantActive: { mutateAsync: h.setVariantActive } }),
}));
vi.mock('@/features/tax/hooks', () => ({ useTaxClassifications: (_i: boolean, enabled: boolean) => { h.classificationsEnabled.current = enabled; return { data: enabled ? h.classifications.current : undefined }; } }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
vi.mock('./model-form-dialog', () => ({ ModelFormDialog: (p: { open: boolean }) => (p.open ? <div data-testid="model-form" /> : null) }));
vi.mock('./variant-form-dialog', () => ({ VariantFormDialog: (p: { open: boolean; modelId: string; variant?: CatalogVariantDto }) => (p.open ? <div data-testid="variant-form" data-model={p.modelId} data-variant={p.variant?.id ?? 'new'} /> : null) }));
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  type P = { children?: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; className?: string };
  return {
    DropdownMenu: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, onClick, className }: P) => React.createElement('button', { type: 'button', onClick, className }, children),
  };
});
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { 'aria-label': 'Variant status', value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null, SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const model = (over: Partial<CatalogModelDto> = {}): CatalogModelDto => ({ id: 'm1', brand: 'TESTBRAND', name: 'VX1', description: 'Flagship', isActive: true, taxClassificationId: null, variantCount: 1, unitCount: 3, createdAt: '', updatedAt: '', ...over });
const variant = (over: Partial<CatalogVariantDto> = {}): CatalogVariantDto => ({
  id: 'v1', modelId: 'm1', model: { id: 'm1', brand: 'TESTBRAND', name: 'VX1' }, name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: '12500000',
  batteryType: null, batteryCapacity: null, rangeKm: 120, topSpeedKmph: null, chargingTimeHrs: null, motorPowerW: 2500, warrantyMonths: null, isActive: true, unitCount: 3, createdAt: '', updatedAt: '', ...over,
});
const renderWith = (perms: string[], m: CatalogModelDto | null = model(), vs: CatalogVariantDto[] = [variant()]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  h.model.current = m;
  h.variants.current = vs;
  render(<MemoryRouter><ModelDetailDialog id={m ? m.id : null} onOpenChange={() => {}} /></MemoryRouter>);
};
const btn = (name: RegExp) => screen.queryByRole('button', { name });
beforeEach(() => { h.setModelActive.mockReset().mockResolvedValue({}); h.setVariantActive.mockReset().mockResolvedValue({}); h.navigate.mockReset(); h.toastSuccess.mockReset(); h.toastError.mockReset(); h.classifications.current = []; h.variantQuery.current = null; });

describe('ModelDetailDialog — content', () => {
  it('13. loads the model and only that model\'s active variants, with price, range, motor, units and status', () => {
    renderWith(['inventory.view']);
    expect(h.variantQuery.current).toEqual({ modelId: 'm1', status: 'active' });
    expect(screen.getByText('TESTBRAND VX1')).toBeInTheDocument();
    expect(screen.getByText('Flagship')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Pro/ });
    expect(within(row).getByText('Teal')).toBeInTheDocument();
    expect(within(row).getByText('₹1,25,000')).toBeInTheDocument();
    expect(within(row).getByText('120 km')).toBeInTheDocument();
    expect(within(row).getByText('2500 W')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('variant status filter re-queries the API', () => {
    renderWith(['inventory.view']);
    fireEvent.change(screen.getByLabelText('Variant status'), { target: { value: 'all' } });
    expect(h.variantQuery.current).toEqual({ modelId: 'm1', status: 'all' });
  });

  it('nothing is requested while closed', () => {
    renderWith(['inventory.view'], null);
    expect(h.variantQuery.current).toEqual({ modelId: null, status: 'active' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('empty variants: "No variants yet" with Add variant only for inventory.create', () => {
    renderWith(['inventory.view'], model(), []);
    expect(screen.getByText('No variants yet')).toBeInTheDocument();
    expect(btn(/Add variant/)).toBeNull();
    renderWith(['inventory.view', 'inventory.create'], model(), []);
    expect(screen.getAllByRole('button', { name: /Add variant/ }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('ModelDetailDialog — permissions and actions', () => {
  it('14. Add variant needs inventory.create and an active model; it opens the form for this model', () => {
    renderWith(['inventory.view', 'inventory.update']);
    expect(btn(/Add variant/)).toBeNull();
    renderWith(['inventory.view', 'inventory.create'], model({ isActive: false }));
    expect(btn(/Add variant/)).toBeDisabled();
    renderWith(['inventory.view', 'inventory.create']);
    fireEvent.click(btn(/Add variant/)!);
    expect(screen.getByTestId('variant-form')).toHaveAttribute('data-model', 'm1');
    expect(screen.getByTestId('variant-form')).toHaveAttribute('data-variant', 'new');
  });

  it('16 + 20. Edit variant / Edit model / Deactivate need inventory.update; create alone or a viewer gets none', () => {
    renderWith(['inventory.view', 'inventory.create']);
    expect(btn(/Edit variant/)).toBeNull();
    expect(btn(/^Edit$/)).toBeNull();
    expect(btn(/^Deactivate$/)).toBeNull();
    renderWith(['inventory.view']);
    expect(btn(/Actions for/)).toBeNull();
    renderWith(['inventory.view', 'inventory.update']);
    fireEvent.click(btn(/Edit variant/)!);
    expect(screen.getByTestId('variant-form')).toHaveAttribute('data-variant', 'v1');
    fireEvent.click(btn(/^Edit$/)!);
    expect(screen.getByTestId('model-form')).toBeInTheDocument();
  });

  it('18. deactivating a variant confirms with the explanation and calls the variant endpoint only', async () => {
    renderWith(['inventory.view', 'inventory.update']);
    fireEvent.click(btn(/Deactivate variant/)!);
    const dialog = screen.getAllByRole('dialog').at(-1)!;
    expect(dialog).toHaveTextContent('Deactivate Pro · Teal?');
    expect(dialog).toHaveTextContent('The model is not affected');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Deactivate$/ }));
    await waitFor(() => expect(h.setVariantActive).toHaveBeenCalledWith({ id: 'v1', isActive: false }));
    expect(h.setModelActive).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('Variant deactivated');
  });

  it('18. an inactive variant offers Activate variant', async () => {
    renderWith(['inventory.view', 'inventory.update'], model(), [variant({ isActive: false })]);
    fireEvent.click(btn(/Activate variant/)!);
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: /^Activate$/ }));
    await waitFor(() => expect(h.setVariantActive).toHaveBeenCalledWith({ id: 'v1', isActive: true }));
  });

  it('deactivating the model from the detail explains that variants are not cascaded', async () => {
    renderWith(['inventory.view', 'inventory.update']);
    fireEvent.click(btn(/^Deactivate$/)!);
    const dialog = screen.getAllByRole('dialog').at(-1)!;
    expect(dialog).toHaveTextContent('variants are NOT deactivated');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Deactivate$/ }));
    await waitFor(() => expect(h.setModelActive).toHaveBeenCalledWith({ id: 'm1', isActive: false }));
    expect(h.setVariantActive).not.toHaveBeenCalled();
  });
});

describe('ModelDetailDialog — GST (read-only)', () => {
  it('23 + 24. shows the stored classification and offers Manage GST → Settings → GST Management', () => {
    h.classifications.current = [{ id: 'c1', name: 'EV two-wheeler', codeType: 'HSN', code: 'TEST-8711', treatment: 'TAXABLE', isActive: true }];
    renderWith(['inventory.view', 'inventory.update', 'settings.view'], model({ taxClassificationId: 'c1' }));
    expect(screen.getByText('GST classification')).toBeInTheDocument();
    expect(screen.getByText('EV two-wheeler')).toBeInTheDocument();
    expect(screen.getByText('TEST-8711')).toBeInTheDocument();
    fireEvent.click(btn(/Manage GST/)!);
    expect(h.navigate).toHaveBeenCalledWith('/settings/gst');
  });

  it('25. no classification editor anywhere; without settings.view the GST list is not requested and only a status is shown', () => {
    renderWith(['inventory.view', 'inventory.update'], model({ taxClassificationId: 'c1' }));
    expect(h.classificationsEnabled.current).toBe(false);
    expect(screen.getByText(/^Configured\./)).toBeInTheDocument();
    expect(btn(/Manage GST/)).toBeNull();
    expect(screen.getByText(/Managed in Settings → GST Management/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /classification/i })).toBeNull();
    renderWith(['inventory.view'], model({ taxClassificationId: null }));
    expect(screen.getByText(/Not configured — this model cannot be invoiced/)).toBeInTheDocument();
  });
});
