import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import type { CatalogModelDto } from '@azad/shared';
import { ModelFormDialog } from './model-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../hooks', () => ({ useCatalogMutations: () => ({ createModel: { mutateAsync: h.create }, updateModel: { mutateAsync: h.update } }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const model: CatalogModelDto = { id: 'm1', brand: 'TESTBRAND', name: 'VX1', description: 'Flagship', isActive: true, taxClassificationId: 'c1', variantCount: 2, unitCount: 7, createdAt: '', updatedAt: '' };
const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const fill = (label: string, value: string): void => { fireEvent.change(field(label), { target: { value } }); };
beforeEach(() => { h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue({}); h.toastError.mockReset(); h.toastSuccess.mockReset(); });
afterEach(cleanup);

describe('ModelFormDialog', () => {
  it('8. create sends brand, name and description only — trimmed, empty description omitted', async () => {
    const onOpenChange = vi.fn();
    render(<ModelFormDialog open onOpenChange={onOpenChange} />);
    fill('Brand', '  TESTBRAND ');
    fill('Model name', ' VX1 ');
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ brand: 'TESTBRAND', name: 'VX1', description: undefined }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.toastSuccess).toHaveBeenCalledWith('Model added');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('requires brand and name (shared schema) and does not submit without them', async () => {
    render(<ModelFormDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    await waitFor(() => expect(screen.getAllByText(/at least 1 character/).length).toBe(2));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('10. edit pre-fills and sends the three editable fields; no GST, counts, companyId or audit fields', async () => {
    render(<ModelFormDialog open onOpenChange={() => {}} model={model} />);
    await waitFor(() => expect(field('Model name').value).toBe('VX1'));
    expect(screen.queryByLabelText(/GST|classification/i)).toBeNull();
    fill('Description', 'Flagship 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'm1', input: { brand: 'TESTBRAND', name: 'VX1', description: 'Flagship 2026' } }));
    const sent = h.update.mock.calls[0]![0].input;
    for (const k of ['taxClassificationId', 'variantCount', 'unitCount', 'companyId', 'isActive']) expect(sent).not.toHaveProperty(k);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('a 409 from the server is shown and the dialog stays open', async () => {
    h.create.mockRejectedValueOnce(new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, { status: 409, data: { message: 'Model "VX1" already exists' }, headers: {}, config: {} } as unknown as AxiosResponse));
    const onOpenChange = vi.fn();
    render(<ModelFormDialog open onOpenChange={onOpenChange} />);
    fill('Brand', 'TESTBRAND');
    fill('Model name', 'VX1');
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Model "VX1" already exists'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
