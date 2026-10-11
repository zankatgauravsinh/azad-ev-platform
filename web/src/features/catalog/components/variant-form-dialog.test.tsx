import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import type { CatalogVariantDto } from '@azad/shared';
import { VariantFormDialog, toVariantPayload } from './variant-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../hooks', () => ({ useCatalogMutations: () => ({ createVariant: { mutateAsync: h.create }, updateVariant: { mutateAsync: h.update } }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const variant: CatalogVariantDto = {
  id: 'v1', modelId: 'm1', model: { id: 'm1', brand: 'TESTBRAND', name: 'VX1' }, name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: '12500000',
  batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: '4.50', motorPowerW: 2500, warrantyMonths: 36, isActive: true, unitCount: 3, createdAt: '', updatedAt: '',
};
const field = (label: RegExp | string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const fill = (label: RegExp | string, value: string): void => { fireEvent.change(field(label), { target: { value } }); };
beforeEach(() => { h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue({}); h.toastError.mockReset(); h.toastSuccess.mockReset(); });
afterEach(cleanup);

describe('VariantFormDialog', () => {
  it('15. create sends the catalogue payload under the model from the route — rupees become paise, blanks are omitted', async () => {
    render(<VariantFormDialog open onOpenChange={() => {}} modelId="m1" modelLabel="TESTBRAND VX1" />);
    fill('Variant name', ' Pro ');
    fill('Colour', 'Teal');
    fill('Hex colour', '#00B8A9');
    fill(/list price/, '125000');
    fill('Range (km)', '120');
    fill('Charging time (hrs)', '4.5');
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toEqual({
      modelId: 'm1',
      input: { name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: 12_500_000, batteryType: undefined, batteryCapacity: undefined, rangeKm: 120, topSpeedKmph: undefined, chargingTimeHrs: 4.5, motorPowerW: undefined, warrantyMonths: undefined },
    });
    expect(h.create.mock.calls[0]![0].input).not.toHaveProperty('modelId');
  });

  it('validates name, colour, hex and price before calling the API', async () => {
    render(<VariantFormDialog open onOpenChange={() => {}} modelId="m1" modelLabel="TESTBRAND VX1" />);
    fill('Hex colour', 'teal');
    fill(/list price/, '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(screen.getByText('Variant name is required')).toBeInTheDocument());
    expect(screen.getByText('Colour is required')).toBeInTheDocument();
    expect(screen.getByText('Use a #RRGGBB hex colour')).toBeInTheDocument();
    expect(screen.getByText('Price cannot be negative')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('17 + 19. edit pre-fills from the DTO and sends every editable field — never modelId', async () => {
    render(<VariantFormDialog open onOpenChange={() => {}} modelId="m1" modelLabel="TESTBRAND VX1" variant={variant} />);
    await waitFor(() => expect(field('Variant name').value).toBe('Pro'));
    expect(field(/list price/).value).toBe('125000');
    expect(field('Charging time (hrs)').value).toBe('4.5');
    expect(screen.queryByLabelText(/model/i)).toBeNull(); // no model field at all
    fill(/list price/, '129000');
    fill('Warranty (months)', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const { id, input } = h.update.mock.calls[0]![0];
    expect(id).toBe('v1');
    expect(input).toMatchObject({ name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: 12_900_000, batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: 4.5, motorPowerW: 2500, warrantyMonths: undefined });
    expect(input).not.toHaveProperty('modelId');
    expect(input).not.toHaveProperty('isActive');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('a duplicate (409) keeps the dialog open and shows the message', async () => {
    h.create.mockRejectedValueOnce(new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, { status: 409, data: { message: 'Variant "Pro" in "Teal" already exists for this model' }, headers: {}, config: {} } as unknown as AxiosResponse));
    const onOpenChange = vi.fn();
    render(<VariantFormDialog open onOpenChange={onOpenChange} modelId="m1" modelLabel="TESTBRAND VX1" />);
    fill('Variant name', 'Pro'); fill('Colour', 'Teal'); fill(/list price/, '1');
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Variant "Pro" in "Teal" already exists for this model'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('toVariantPayload: the pure mapping', () => {
    expect(toVariantPayload({ name: 'Pro', colour: 'Red', hexColour: '', priceRupees: 1000.5, batteryType: '', batteryCapacity: 'x', rangeKm: '', topSpeedKmph: 80, chargingTimeHrs: '', motorPowerW: 0, warrantyMonths: 12 }))
      .toEqual({ name: 'Pro', colour: 'Red', hexColour: undefined, exShowroomPrice: 100050, batteryType: undefined, batteryCapacity: 'x', rangeKm: undefined, topSpeedKmph: 80, chargingTimeHrs: undefined, motorPowerW: 0, warrantyMonths: 12 });
  });

  it('M4B.5: a variant in use keeps name and colour read-only, explains why, and still saves price, specs and hex colour', async () => {
    const onSaved = vi.fn();
    h.update.mockResolvedValue({ ...variant, exShowroomPrice: '13000000' });
    render(<VariantFormDialog open onOpenChange={() => {}} modelId="m1" modelLabel="TESTBRAND VX1" variant={{ ...variant, identityLocked: true }} onSaved={onSaved} />);
    expect(field('Variant name').readOnly).toBe(true);
    expect(field('Colour').readOnly).toBe(true);
    expect(field('Hex colour').readOnly).toBe(false);
    expect(screen.getByRole('note').textContent).toContain('Add a new variant for future stock');
    fill(/list price/, '130000');
    fill('Hex colour', '#112233');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const { input } = h.update.mock.calls[0]![0];
    expect(input).toMatchObject({ exShowroomPrice: 13_000_000, hexColour: '#112233', rangeKm: 120 });
    expect(input.name).toBeUndefined();
    expect(input.colour).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ exShowroomPrice: '13000000' })));
  });

  it('reports the created variant to the caller (the Add Scooter shortcut selects it)', async () => {
    const onSaved = vi.fn();
    h.create.mockResolvedValue({ ...variant, id: 'v-new' });
    render(<VariantFormDialog open onOpenChange={() => {}} modelId="m1" modelLabel="TESTBRAND VX1" onSaved={onSaved} />);
    fill('Variant name', 'Max');
    fill('Colour', 'Lime');
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-new' })));
  });
});
