import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { UnitIdentityPolicy } from '@azad/shared';
import type { UnitDetail, VariantOption } from '../api';
import { UnitFormDialog } from './unit-form-dialog';

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const vx = { id: M1, brand: 'Azad', name: 'VX' };
const mx = { id: M2, brand: 'Azad', name: 'MX' };
const variant = (id: string, name: string, colour: string, model = vx, price = '12500000'): VariantOption => ({ id, name, colour, hexColour: '#00B8A9', exShowroomPrice: price, model });

const h = vi.hoisted(() => ({
  perms: new Set<string>(),
  models: [] as unknown[],
  variants: {} as Record<string, unknown[]>,
  /** Every model whose variants were actually requested (enabled queries). */
  fetchedVariantsOf: [] as string[],
  create: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.has(p) }) }));
vi.mock('../hooks', () => ({
  useModels: () => ({ data: h.models }),
  useVariants: (modelId: string | undefined, enabled: boolean) => {
    if (enabled && modelId) h.fetchedVariantsOf.push(modelId);
    return { data: enabled && modelId ? h.variants[modelId] ?? [] : [] };
  },
  useCreateUnit: () => ({ mutateAsync: h.create }),
  useUpdateUnit: () => ({ mutateAsync: h.update }),
}));
vi.mock('../api', () => ({ inventoryApi: { checkVin: vi.fn().mockResolvedValue({ exists: false }) } }));
vi.mock('@/features/settings/hooks', () => ({ useCompanySettings: () => ({ data: { taxPercentage: '5', defaultWarrantyMonths: 36 } }) }));
vi.mock('./vin-scanner', () => ({ VinScanner: () => null }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
// The existing catalogue dialog, stubbed: "creating" a variant adds it to the model's list and reports it back.
vi.mock('@/features/catalog/components/variant-form-dialog', async () => {
  const React = await import('react');
  return {
    VariantFormDialog: ({ modelId, onSaved }: { modelId: string; onSaved?: (v: unknown) => void }) =>
      React.createElement('button', {
        type: 'button',
        onClick: () => {
          const created = { id: NEW, name: 'Max', colour: 'Lime', hexColour: null, exShowroomPrice: '13000000', model: { id: modelId, brand: 'Azad', name: 'VX' } };
          h.variants[modelId] = [...(h.variants[modelId] ?? []), created];
          onSaved?.(created);
        },
      }, 'Create variant (stub)'),
  };
});
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; disabled?: boolean; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, disabled, children }: P) =>
      React.createElement('select', { value, disabled, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, React.createElement('option', { value: '' }, '—'), children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const selects = (): HTMLSelectElement[] => screen.getAllByRole('combobox') as HTMLSelectElement[];
const choose = (index: number, value: string): void => { fireEvent.change(selects()[index]!, { target: { value } }); };
const fill = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); };
const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const submit = (name: string): void => { fireEvent.click(screen.getByRole('button', { name })); };

const policy = (over: Partial<UnitIdentityPolicy> = {}): UnitIdentityPolicy => ({ committed: false, catalogueEditable: true, identificationEditable: true, correctionEligible: false, ...over });
const unit = (status: string, identity: UnitIdentityPolicy): UnitDetail => ({
  id: 'u1', vin: 'VIN0001', motorNumber: 'MOT0001', batteryNumber: 'BAT0001', status, purchaseDate: null, purchaseCost: '5000000', sellingPrice: '12000000',
  supplier: 'Acme', location: 'Bay 1', notes: null, createdAt: '', updatedAt: '',
  variant: { id: V1, name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', model: vx },
  identity, events: [], photos: [], documents: [], bookings: [], sales: [], serviceJobs: [],
} as unknown as UnitDetail);

beforeEach(() => {
  h.perms = new Set(['inventory.create', 'inventory.update']);
  h.models = [vx, mx];
  h.variants = { [M1]: [variant(V1, 'Pro', 'Teal'), variant(V2, 'Max', 'Red')], [M2]: [variant(V3, 'Lite', 'Blue', mx)] };
  h.fetchedVariantsOf = [];
  h.create.mockReset().mockResolvedValue({});
  h.update.mockReset().mockResolvedValue({});
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});
afterEach(cleanup);

describe('UnitFormDialog — Add scooter', () => {
  const fillIdentifiers = (): void => { fill('VIN', ' md9abc123 '); fill('Motor number', 'm-1'); fill('Battery number', 'b-1'); };

  it('selects model → variant and submits only the variantId; the colour comes from the variant; a blank price is left out', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole('textbox', { name: 'Variant' })).toBeNull(); // no free-text variant
    expect(field('Colour').readOnly).toBe(true);
    choose(0, M1);
    choose(1, V2);
    expect(field('Colour').value).toBe('Red');
    expect(field('Selling price (₹)').placeholder).toContain('List price');
    fillIdentifiers();
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    const input = h.create.mock.calls[0]![0];
    expect(input).toMatchObject({ variantId: V2, vin: 'MD9ABC123', motorNumber: 'M-1', batteryNumber: 'B-1', status: 'AVAILABLE' });
    // Without inventory.cost there is no purchase section and nothing about cost is sent.
    expect(screen.queryByText('Purchase cost')).toBeNull();
    for (const key of ['sellingPrice', 'modelId', 'variant', 'colour', 'hexColour', 'purchasePrice', 'purchaseGst', 'purchaseGstRate', 'transportCharge', 'purchaseCost']) expect(input).not.toHaveProperty(key);
  });

  it('keeps an explicit selling price, independent of the list price', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fillIdentifiers();
    fill('Selling price (₹)', '99000');
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0].sellingPrice).toBe(9_900_000);
  });

  it('changing the model clears the variant (a variant belongs to one model); a variant is required', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    choose(0, M2);
    expect(selects()[1]!.value).toBe('');
    fillIdentifiers();
    submit('Add scooter');
    expect(await screen.findByText('Select a variant')).toBeTruthy();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('Add variant shortcut: creates under the chosen model, the list refreshes and the new variant is selected', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull(); // no model yet
    choose(0, M1);
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create variant (stub)' }));
    await waitFor(() => expect(selects()[1]!.value).toBe(NEW));
    expect(field('Colour').value).toBe('Lime');
    fillIdentifiers();
    submit('Add scooter');
    await waitFor(() => expect(h.create.mock.calls[0]![0].variantId).toBe(NEW));
  });

  it('no Add variant shortcut without inventory.create, or for an inactive model', () => {
    h.perms = new Set(['inventory.update']);
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull();
    cleanup();
    // The unit's own model is inactive (not in the active list): it stays selected, but no variants are added to it.
    h.perms = new Set(['inventory.create', 'inventory.update']);
    h.models = [mx];
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    expect(selects()[0]!.value).toBe(M1);
    expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull();
  });

  it('shows a server error safely', async () => {
    h.create.mockRejectedValue(new AxiosError('x', '409', undefined, undefined, { status: 409, data: { message: 'A scooter with VIN MD9ABC123 already exists' } } as AxiosResponse));
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fillIdentifiers();
    submit('Add scooter');
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('A scooter with VIN MD9ABC123 already exists'));
  });
});

describe('UnitFormDialog — Edit scooter', () => {
  it('never committed (AVAILABLE): variant and identifiers editable; only what changed is sent', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(selects()[1]!.disabled).toBe(false);
    choose(1, V2);
    fill('VIN', 'vin0002');
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const input = h.update.mock.calls[0]![0];
    expect(input).toMatchObject({ variantId: V2, vin: 'VIN0002', sellingPrice: 12_000_000, location: 'Bay 1' });
    expect(input).not.toHaveProperty('motorNumber');
    expect(input).not.toHaveProperty('batteryNumber');
  });

  it('BOOKED without history: model / variant locked, identifiers still editable', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('BOOKED', policy({ catalogueEditable: false }))} />);
    expect(selects()[0]!.disabled).toBe(true);
    expect(selects()[1]!.disabled).toBe(true);
    expect(field('VIN').readOnly).toBe(false);
    expect(screen.getByRole('note').textContent).toContain('booked');
    expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull();
    fill('Battery number', 'bat0009');
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0]![0]).toMatchObject({ batteryNumber: 'BAT0009' });
    expect(h.update.mock.calls[0]![0]).not.toHaveProperty('variantId');
  });

  it('committed history (e.g. restocked after a return): all identity controls locked; points to the owner correction', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy({ committed: true, catalogueEditable: false, identificationEditable: false, correctionEligible: true }))} />);
    expect(selects()[0]!.disabled).toBe(true);
    expect(selects()[1]!.disabled).toBe(true);
    for (const label of ['VIN', 'Motor number', 'Battery number']) expect(field(label).readOnly).toBe(true);
    expect((screen.getByRole('button', { name: 'Scan VIN' }) as HTMLButtonElement).disabled).toBe(true);
    const note = screen.getByRole('note').textContent ?? '';
    expect(note).toContain('sale, warranty or AMC history');
    expect(note).toContain('Correct identification');
    fill('Location', 'Bay 9');
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const input = h.update.mock.calls[0]![0];
    expect(input).toMatchObject({ location: 'Bay 9', supplier: 'Acme' });
    for (const key of ['variantId', 'vin', 'motorNumber', 'batteryNumber']) expect(input).not.toHaveProperty(key);
  });

  it('DELIVERED without history: locked by status, with the matching explanation', () => {
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('DELIVERED', policy({ catalogueEditable: false, identificationEditable: false, correctionEligible: true }))} />);
    expect(screen.getByRole('note').textContent).toContain('has been delivered');
    expect(field('Motor number').readOnly).toBe(true);
  });

  const variantOptions = (): string[] => [...selects()[1]!.options].map((o) => o.value).filter(Boolean);

  it("the unit's current model / variant stay selected even if inactive in the catalogue", () => {
    h.models = [mx];
    h.variants = { [M1]: [] };
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    expect(selects()[0]!.value).toBe(M1);
    expect(selects()[1]!.value).toBe(V1);
    expect(field('Colour').value).toBe('Teal');
  });

  it('an inactive current model offers only the current variant — not its other active variants, which are not even fetched', async () => {
    h.models = [mx]; // M1 (the unit's model) is inactive; its variants V1 (current) and V2 are still active
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    expect(selects()[1]!.value).toBe(V1);
    expect(variantOptions()).toEqual([V1]);
    expect(h.fetchedVariantsOf).not.toContain(M1);
    // Saving unchanged sends no variant change.
    fill('Location', 'Bay 4');
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0]![0]).not.toHaveProperty('variantId');
  });

  it('from an inactive current model, switching to an active model offers its active variants; switching back offers only the current variant', () => {
    h.models = [mx];
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    choose(0, M2);
    expect(variantOptions()).toEqual([V3]);
    choose(0, M1);
    expect(variantOptions()).toEqual([V1]);
    expect(h.fetchedVariantsOf).not.toContain(M1);
  });

  it('an active current model keeps offering all its active variants (unchanged)', () => {
    render(<UnitFormDialog open onOpenChange={() => {}} unit={unit('AVAILABLE', policy())} />);
    expect(variantOptions()).toEqual([V1, V2]);
    expect(h.fetchedVariantsOf).toContain(M1);
  });
});

describe('UnitFormDialog — purchase cost (owner) and controller / charger numbers', () => {
  const fillIdentifiers = (): void => { fill('VIN', 'md9abc123'); fill('Motor number', 'm-1'); fill('Battery number', 'b-1'); };

  it('price + GST from the rate (default 5%) + transport; the total is shown and the parts are sent', async () => {
    h.perms = new Set(['inventory.create', 'inventory.update', 'inventory.cost']);
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fillIdentifiers();
    fill('Controller number', 'ctl-1');
    expect(field('GST rate (%)').value).toBe('5');
    fill('Purchase price (₹)', '100000');
    fill('Transport charge (₹)', '1500');
    expect(screen.getByLabelText('Purchase cost total')).toHaveTextContent('₹1,06,500');
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ controllerNumber: 'CTL-1', purchasePrice: 10_000_000, purchaseGstRate: 5, transportCharge: 150_000 });
    expect(h.create.mock.calls[0]![0]).not.toHaveProperty('purchaseGst');
  });

  it('the pencil switches GST to a typed amount', async () => {
    h.perms = new Set(['inventory.create', 'inventory.update', 'inventory.cost']);
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fillIdentifiers();
    fill('Purchase price (₹)', '100000');
    fireEvent.click(screen.getByRole('button', { name: 'Type the GST amount instead' }));
    expect(field('GST paid (₹)').value).toBe('5000'); // starts from what the rate gave
    fill('GST paid (₹)', '5123');
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ purchasePrice: 10_000_000, purchaseGst: 512_300 });
    expect(h.create.mock.calls[0]![0]).not.toHaveProperty('purchaseGstRate');
  });

  it('after sale a recorded controller number is read-only; a blank charger number can still be filled in', async () => {
    const locked = { ...unit('DELIVERED', policy({ catalogueEditable: false, identificationEditable: false })), controllerNumber: 'CTL-1', chargerNumber: null } as UnitDetail;
    render(<UnitFormDialog open onOpenChange={() => {}} unit={locked} />);
    expect(field('Controller number').readOnly).toBe(true);
    expect(field('Charger number').readOnly).toBe(false);
    fill('Charger number', 'chg-9');
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0]![0]).toMatchObject({ chargerNumber: 'CHG-9' });
    expect(h.update.mock.calls[0]![0]).not.toHaveProperty('controllerNumber');
  });
});

describe('UnitFormDialog — component warranty months', () => {
  const months = (label: string): HTMLInputElement => within(screen.getByRole('group', { name: 'Warranty months' })).getByLabelText(label) as HTMLInputElement;

  it('a new scooter starts from the company default; the months entered are sent', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    await waitFor(() => expect(months('Motor').value).toBe('36'));
    expect(months('Charger').value).toBe('36');
    choose(0, M1);
    choose(1, V1);
    fill('VIN', 'VIN1');
    fill('Motor number', 'M1');
    fill('Battery number', 'B1');
    fireEvent.change(months('Battery'), { target: { value: '60' } });
    fireEvent.change(months('Charger'), { target: { value: '0' } });
    fireEvent.change(months('Controller'), { target: { value: '' } });
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    const input = h.create.mock.calls[0]![0];
    expect(input).toMatchObject({ motorWarrantyMonths: 36, batteryWarrantyMonths: 60, chargerWarrantyMonths: 0 });
    expect(input.controllerWarrantyMonths).toBeUndefined(); // blank → the company default
    expect(input).not.toHaveProperty('warrantyExtras');
  });

  it('+ adds an item of your own (name + months) for the warranty card; × removes one', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fill('VIN', 'VIN1');
    fill('Motor number', 'M1');
    fill('Battery number', 'B1');
    fireEvent.click(screen.getByRole('button', { name: /Add warranty item/ }));
    expect(field('Extra item 1 months').value).toBe('36'); // starts from the company default
    fireEvent.change(field('Extra item 1 name'), { target: { value: ' Hub bearings ' } });
    fireEvent.change(field('Extra item 1 months'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: /Add warranty item/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove extra item 2' }));
    submit('Add scooter');
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0].warrantyExtras).toEqual([{ name: 'Hub bearings', months: 18 }]);
  });

  it('an extra item needs a name', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fill('VIN', 'VIN1');
    fill('Motor number', 'M1');
    fill('Battery number', 'B1');
    fireEvent.click(screen.getByRole('button', { name: /Add warranty item/ }));
    submit('Add scooter');
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('an edit sends only the months that changed', async () => {
    const u = { ...unit('AVAILABLE', policy()), motorWarrantyMonths: 36, batteryWarrantyMonths: 36, controllerWarrantyMonths: null, chargerWarrantyMonths: 12 } as UnitDetail;
    render(<UnitFormDialog open onOpenChange={() => {}} unit={u} />);
    expect(months('Controller').value).toBe('');
    fireEvent.change(months('Motor'), { target: { value: '48' } });
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const input = h.update.mock.calls[0]![0];
    expect(input).toMatchObject({ motorWarrantyMonths: 48 });
    for (const key of ['batteryWarrantyMonths', 'controllerWarrantyMonths', 'chargerWarrantyMonths']) expect(input).not.toHaveProperty(key);
  });

  it('once the warranty card is issued the months are read-only and never sent', async () => {
    const u = { ...unit('DELIVERED', policy({ committed: true, catalogueEditable: false, identificationEditable: false })), motorWarrantyMonths: 36, batteryWarrantyMonths: 36, controllerWarrantyMonths: 36, chargerWarrantyMonths: 36, warrantyExtras: [{ name: 'Mirror', months: 6 }], warrantyIssued: true } as UnitDetail;
    render(<UnitFormDialog open onOpenChange={() => {}} unit={u} />);
    expect(months('Motor').readOnly).toBe(true);
    expect(field('Extra item 1 name').readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /Add warranty item/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove extra item 1' })).toBeNull();
    expect(screen.getByText(/owner changes these months and items from the warranty/)).toBeInTheDocument();
    submit('Save changes');
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    for (const key of ['motorWarrantyMonths', 'batteryWarrantyMonths', 'controllerWarrantyMonths', 'chargerWarrantyMonths', 'warrantyExtras']) expect(h.update.mock.calls[0]![0]).not.toHaveProperty(key);
  });

  it('refuses a purchase date in the future', async () => {
    render(<UnitFormDialog open onOpenChange={() => {}} />);
    choose(0, M1);
    choose(1, V1);
    fill('VIN', 'VIN9');
    fill('Motor number', 'M9');
    fill('Battery number', 'B9');
    fill('Purchase date', new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    submit('Add scooter');
    expect(await screen.findByText('Purchase date cannot be in the future')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });
});
