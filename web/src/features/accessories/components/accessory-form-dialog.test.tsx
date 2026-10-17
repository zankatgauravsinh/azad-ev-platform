import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AccessoryDto } from '@azad/shared';
import { AccessoryFormDialog } from './accessory-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toastError: vi.fn() }));
vi.mock('../hooks', () => ({
  useAccessoryCategories: () => ({ data: ['Safety', 'Comfort'] }),
  useAccessoryMutations: () => ({ create: { mutateAsync: h.create }, update: { mutateAsync: h.update } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

const helmet = { id: 'a1', name: 'Helmet', sku: 'HEL-01', category: 'Safety', sellPrice: '150000', onHand: 4, reserved: 0, available: 4, minStock: 2, lowStock: false, isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '' } as AccessoryDto;
const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string): void => { fireEvent.change(field(label), { target: { value } }); };

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({});
  h.update.mockReset().mockResolvedValue({});
  h.toastError.mockReset();
});
afterEach(cleanup);

describe('AccessoryFormDialog', () => {
  it('adds an accessory: rupees sent as paise, blanks as null, no stock or cost fields', async () => {
    const onOpenChange = vi.fn();
    render(<AccessoryFormDialog open onOpenChange={onOpenChange} />);
    expect(screen.queryByLabelText(/stock on hand|cost/i)).toBeNull();
    type('Name', ' Seat cover ');
    type('Selling price (₹)', '799.50');
    type('Low-stock alert at', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Add accessory' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ name: 'Seat cover', sku: null, category: null, sellPrice: 79950, minStock: 3, isPart: false }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requires a name and refuses negative numbers', async () => {
    render(<AccessoryFormDialog open onOpenChange={() => {}} />);
    type('Selling price (₹)', '-5');
    fireEvent.click(screen.getByRole('button', { name: 'Add accessory' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Cannot be negative')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('an edit sends only what changed', async () => {
    render(<AccessoryFormDialog open onOpenChange={() => {}} accessory={helmet} />);
    expect(field('Name').value).toBe('Helmet');
    expect(field('Selling price (₹)').value).toBe('1500');
    type('Selling price (₹)', '1750');
    type('Category (optional)', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'a1', body: { category: null, sellPrice: 175000 } }));
  });

  it('a lower-case SKU equal to the saved one is not a change', async () => {
    const onOpenChange = vi.fn();
    render(<AccessoryFormDialog open onOpenChange={onOpenChange} accessory={helmet} />);
    type('SKU (optional)', 'hel-01');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.update).not.toHaveBeenCalled();
  });

  it('shows the server message (e.g. a duplicate name)', async () => {
    h.create.mockRejectedValue(new Error('An accessory named "Helmet" already exists'));
    render(<AccessoryFormDialog open onOpenChange={() => {}} />);
    type('Name', 'helmet');
    fireEvent.click(screen.getByRole('button', { name: 'Add accessory' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});
