import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler, ChangeEvent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogModelDto } from '@azad/shared';
import { ModelsPage } from './models-page';

const h = vi.hoisted(() => ({
  perms: { current: new Set<string>() },
  models: { current: [] as CatalogModelDto[] },
  lastQuery: { current: null as unknown },
  lastEnabled: { current: null as boolean | null },
  setModelActive: vi.fn(),
  classifications: { current: [] as unknown[] },
  classificationsEnabled: { current: null as boolean | null },
  toastSuccess: vi.fn(), toastError: vi.fn(),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: <T,>(v: T) => v }));
vi.mock('../hooks', () => ({
  useCatalogModels: (query: unknown, enabled: boolean) => { h.lastQuery.current = query; h.lastEnabled.current = enabled; return { data: enabled ? h.models.current : undefined, isLoading: false, isFetching: false }; },
  useCatalogMutations: () => ({ setModelActive: { mutateAsync: h.setModelActive } }),
}));
vi.mock('@/features/tax/hooks', () => ({ useTaxClassifications: (_inactive: boolean, enabled: boolean) => { h.classificationsEnabled.current = enabled; return { data: enabled ? h.classifications.current : undefined }; } }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
vi.mock('../components/model-form-dialog', () => ({ ModelFormDialog: (p: { open: boolean; model?: CatalogModelDto }) => (p.open ? <div data-testid="model-form" data-model={p.model?.id ?? 'new'} /> : null) }));
vi.mock('../components/model-detail-dialog', () => ({ ModelDetailDialog: (p: { id: string | null }) => (p.id ? <div data-testid="model-detail" data-id={p.id} /> : null) }));
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  type P = { children?: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; className?: string };
  return {
    DropdownMenu: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, onClick, className }: P) => React.createElement('button', { type: 'button', onClick, className }, children),
    DropdownMenuSeparator: () => null,
  };
});
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { 'aria-label': 'Status filter', value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null, SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const model = (over: Partial<CatalogModelDto> = {}): CatalogModelDto => ({
  id: 'm1', brand: 'TESTBRAND', name: 'VX1', description: 'Flagship', isActive: true, taxClassificationId: null, variantCount: 2, unitCount: 7, createdAt: '', updatedAt: '', ...over,
});
const renderWith = (perms: string[], models: CatalogModelDto[] = [model()]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  h.models.current = models;
  render(<MemoryRouter><ModelsPage /></MemoryRouter>);
};
const btn = (name: RegExp) => screen.queryByRole('button', { name });
beforeEach(() => { h.setModelActive.mockReset().mockResolvedValue({}); h.toastSuccess.mockReset(); h.toastError.mockReset(); h.classifications.current = []; h.lastQuery.current = null; h.lastEnabled.current = null; });

describe('ModelsPage — access', () => {
  it('3. without inventory.view: access denied, no list requested', () => {
    renderWith([]);
    expect(screen.getByText(/don’t have permission to view the catalogue/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(h.lastEnabled.current).toBe(false);
  });

  it('4. with inventory.view the list loads with brand, model, counts, GST and status', () => {
    renderWith(['inventory.view']);
    expect(h.lastEnabled.current).toBe(true);
    const row = screen.getByRole('row', { name: /VX1/ });
    expect(within(row).getByText('TESTBRAND')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText('Not configured')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });
});

describe('ModelsPage — search and filter', () => {
  it('5. search goes to the API query; 6. status defaults to active and switches to inactive / all', () => {
    renderWith(['inventory.view']);
    expect(h.lastQuery.current).toEqual({ q: undefined, status: 'active' });
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: ' vx ' } });
    expect(h.lastQuery.current).toEqual({ q: 'vx', status: 'active' });
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'inactive' } });
    expect(h.lastQuery.current).toEqual({ q: 'vx', status: 'inactive' });
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'all' } });
    expect(h.lastQuery.current).toEqual({ q: 'vx', status: 'all' });
  });

  it('empty states: "No models yet" with Add model only for inventory.create; a filtered miss says so', () => {
    renderWith(['inventory.view'], []);
    expect(screen.getByText('No models yet')).toBeInTheDocument();
    expect(btn(/Add model/)).toBeNull();
    renderWith(['inventory.view', 'inventory.create'], []);
    expect(screen.getAllByRole('button', { name: /Add model/ }).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'zzz' } });
    expect(screen.getByText('No models match')).toBeInTheDocument();
  });
});

describe('ModelsPage — permissions and actions', () => {
  it('7 + 20. Add model needs inventory.create; a viewer sees no actions at all', () => {
    renderWith(['inventory.view']);
    expect(btn(/Add model/)).toBeNull();
    expect(btn(/Actions for/)).toBeNull();
    expect(btn(/^Edit$/)).toBeNull();
    renderWith(['inventory.view', 'inventory.create']);
    fireEvent.click(btn(/Add model/)!);
    expect(screen.getByTestId('model-form')).toHaveAttribute('data-model', 'new');
  });

  it('9 + 11 + 21. Edit / Deactivate need inventory.update — create alone does not unlock them, update alone does not unlock Add', () => {
    renderWith(['inventory.view', 'inventory.create']);
    expect(btn(/^Edit$/)).toBeNull();
    expect(btn(/Deactivate/)).toBeNull();
    renderWith(['inventory.view', 'inventory.update']);
    expect(btn(/Add model/)).toBeNull();
    fireEvent.click(btn(/^Edit$/)!);
    expect(screen.getByTestId('model-form')).toHaveAttribute('data-model', 'm1');
  });

  it('22. unrelated permissions expose nothing', () => {
    renderWith(['inventory.view', 'settings.manage', 'bookings.update', 'roles.manage']);
    expect(btn(/Add model/)).toBeNull();
    expect(btn(/^Edit$/)).toBeNull();
  });

  it('11 + 12. deactivate confirms, explains the consequences, calls the active endpoint and reports', async () => {
    renderWith(['inventory.view', 'inventory.update']);
    fireEvent.click(btn(/^Deactivate$/)!);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Deactivate TESTBRAND VX1?');
    expect(dialog).toHaveTextContent('variants are NOT deactivated');
    expect(dialog).toHaveTextContent('keep referring to it');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Deactivate$/ }));
    await waitFor(() => expect(h.setModelActive).toHaveBeenCalledWith({ id: 'm1', isActive: false }));
    expect(h.toastSuccess).toHaveBeenCalledWith('Deactivated TESTBRAND VX1');
  });

  it('an inactive model offers Activate and sends isActive: true', async () => {
    renderWith(['inventory.view', 'inventory.update'], [model({ isActive: false })]);
    expect(within(screen.getByRole('row', { name: /VX1/ })).getByText('Inactive')).toBeInTheDocument();
    fireEvent.click(btn(/^Activate$/)!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Activate$/ }));
    await waitFor(() => expect(h.setModelActive).toHaveBeenCalledWith({ id: 'm1', isActive: true }));
  });

  it('a failed status change shows the server message', async () => {
    h.setModelActive.mockRejectedValueOnce(new Error('Model not found'));
    renderWith(['inventory.view', 'inventory.update']);
    fireEvent.click(btn(/^Deactivate$/)!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Deactivate$/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it('clicking a row opens the model detail', () => {
    renderWith(['inventory.view']);
    fireEvent.click(screen.getByText('VX1'));
    expect(screen.getByTestId('model-detail')).toHaveAttribute('data-id', 'm1');
  });
});

describe('ModelsPage — GST column (read-only)', () => {
  it('23. shows the classification name and code when the user can see GST settings, never an editor', () => {
    h.classifications.current = [{ id: 'c1', name: 'EV two-wheeler', codeType: 'HSN', code: 'TEST-8711', treatment: 'TAXABLE', isActive: true }];
    renderWith(['inventory.view', 'settings.view'], [model({ taxClassificationId: 'c1' })]);
    expect(h.classificationsEnabled.current).toBe(true);
    expect(screen.getByText('EV two-wheeler')).toBeInTheDocument();
    expect(screen.getByText('HSN TEST-8711')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /classification/i })).toBeNull();
  });

  it('25. without settings.view the GST list is never requested and the column says Configured / Not configured', () => {
    renderWith(['inventory.view'], [model({ taxClassificationId: 'c1' }), model({ id: 'm2', name: 'VZ1' })]);
    expect(h.classificationsEnabled.current).toBe(false);
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });
});
