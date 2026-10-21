import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VendorDto } from '@azad/shared';
import { VendorFormDialog } from './vendor-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toastError: vi.fn() }));
vi.mock('../hooks', () => ({
  useVendorMutations: () => ({ create: { mutateAsync: h.create, isPending: false }, update: { mutateAsync: h.update, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

const vendor = (over: Partial<VendorDto> = {}): VendorDto => ({
  id: 'v1', vendorNumber: 'VND0001', name: 'Comptech', mobile: null, email: null, gstNumber: '31234ewdwd', address: null, city: null, state: null, gstStateCode: null,
  status: 'ACTIVE', type: 'SCOOTER_SUPPLIER', contactPerson: null, altMobile: null, pan: null, creditDays: 0, bankAccountName: null,
  bankAccountNumber: null, bankIfsc: null, bankName: null, upiId: null, notes: null, isDefaultScooterVendor: true, scooterCount: 3,
  outstanding: '0', overdue: '0', advance: '0', totalPurchases: '0', costHidden: false, createdAt: '2026-01-01', ...over,
});
const input = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  h.create.mockReset().mockImplementation(async (b: { name: string }) => vendor({ id: 'v2', name: b.name }));
  h.update.mockReset().mockImplementation(async ({ body }: { body: { name?: string } }) => vendor({ name: body.name ?? 'Comptech' }));
  h.toastError.mockReset();
});
afterEach(cleanup);

describe('VendorFormDialog', () => {
  it('a new vendor: GSTIN, IFSC and UPI are checked before anything is sent', async () => {
    render(<VendorFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(input('Name *'), { target: { value: 'Twin Motors' } });
    fireEvent.change(input('GSTIN'), { target: { value: '24ABCDE1234F1Z5' } });
    fireEvent.change(input('IFSC'), { target: { value: 'SBIN12' } });
    fireEvent.change(input('UPI ID'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    expect(await screen.findByText('Enter a valid 15-character GSTIN')).toBeTruthy();
    expect(screen.getByText(/valid 11-character IFSC/)).toBeTruthy();
    expect(screen.getByText('Enter a UPI ID like name@bank')).toBeTruthy();
    expect(h.create).not.toHaveBeenCalled();

    fireEvent.change(input('GSTIN'), { target: { value: '24abcde1234f1z6' } });
    fireEvent.change(input('IFSC'), { target: { value: 'sbin0001234' } });
    fireEvent.change(input('UPI ID'), { target: { value: 'twin@okicici' } });
    fireEvent.change(input('Credit days'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ name: 'Twin Motors', gstNumber: '24ABCDE1234F1Z6', bankIfsc: 'SBIN0001234', upiId: 'twin@okicici', creditDays: 30 });
  });

  it('the PAN shows what the GSTIN gives when left blank', () => {
    render(<VendorFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(input('GSTIN'), { target: { value: '24ABCDE1234F1Z6' } });
    expect(input('PAN').placeholder).toBe('ABCDE1234F');
  });

  it('an edit does not re-check an old GSTIN left as it was (records from before the checks stay editable)', async () => {
    render(<VendorFormDialog open onOpenChange={() => {}} vendor={vendor()} />);
    fireEvent.change(input('Credit days'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const { body } = h.update.mock.calls[0]![0];
    expect(body.creditDays).toBe(15);
    expect(body).not.toHaveProperty('gstNumber');
  });
});
