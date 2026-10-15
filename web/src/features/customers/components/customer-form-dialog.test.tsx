import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import type { CustomerDto } from '@azad/shared';
import { CustomerFormDialog } from './customer-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('../hooks', () => ({
  useCreateCustomer: () => ({ mutateAsync: h.create }),
  useUpdateCustomer: () => ({ mutateAsync: h.update }),
}));
vi.mock('@/features/inventory/hooks', () => ({ useModels: () => ({ data: [] }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const input = (name: string): HTMLInputElement => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fill = (name: string, value: string): void => { fireEvent.change(input(name), { target: { value } }); };
const submit = (): void => { fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement); };

beforeEach(() => { h.create.mockReset().mockResolvedValue({ id: 'c1' }); h.update.mockReset().mockResolvedValue({ id: 'c1' }); });
afterEach(cleanup);

describe('CustomerFormDialog — GST state code', () => {
  it('is optional and empty by default — never derived from the pre-filled state', async () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} />);
    expect(input('state').value).toBe('Gujarat');
    expect(input('gstStateCode').value).toBe('');
    fill('name', 'Asha Patel');
    fill('phone', '9876543210');
    submit();
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ name: 'Asha Patel', state: 'Gujarat', gstStateCode: '' });
  });

  it('rejects anything that is not two digits and does not submit', async () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Asha Patel');
    fill('phone', '9876543210');
    for (const bad of ['GJ', '2', '240']) {
      fill('gstStateCode', bad);
      submit();
      expect(await screen.findByText('GST state code must be two digits')).toBeInTheDocument();
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it('sends a valid two-digit code on create', async () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Asha Patel');
    fill('phone', '9876543210');
    fill('gstStateCode', '24');
    submit();
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ gstStateCode: '24' });
  });

  it('edit: pre-fills the stored code, and clearing it sends an empty value so it can be removed', async () => {
    const customer = { id: 'c1', name: 'Asha Patel', phone: '9876543210', state: 'Gujarat', gstStateCode: '27', leadStatus: 'NEW' } as unknown as CustomerDto;
    render(<CustomerFormDialog open onOpenChange={() => {}} customer={customer} />);
    await waitFor(() => expect(input('gstStateCode').value).toBe('27'));
    fill('gstStateCode', '');
    submit();
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0]![0]).toMatchObject({ gstStateCode: '' });
  });
});

describe('CustomerFormDialog — RTO details', () => {
  it('sends tehsil, district, Aadhaar, PAN and GSTIN', async () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Asha Patel');
    fill('phone', '9876543210');
    fill('village', 'Panadar');
    fill('tehsil', 'Kodinar');
    fill('district', 'Gir Somnath');
    fill('aadhaarNumber', '2341 2341 2346');
    fill('panNumber', 'abcde1234f');
    submit();
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0]![0]).toMatchObject({ village: 'Panadar', tehsil: 'Kodinar', district: 'Gir Somnath', aadhaarNumber: '2341 2341 2346', panNumber: 'abcde1234f', gstin: '' });
  });

  it('catches a mistyped Aadhaar, PAN or GSTIN before saving', async () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} />);
    fill('name', 'Asha Patel');
    fill('phone', '9876543210');
    fill('aadhaarNumber', '2341 2341 2347'); // last digit wrong: fails the check digit
    fill('panNumber', 'AB12');
    fill('gstin', '24AAJCT0051E1ZU');
    submit();
    expect(await screen.findByText('Enter a valid 12-digit Aadhaar number')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid PAN (e.g. ABCDE1234F)')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid 15-character GSTIN')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('edit: shows the stored Aadhaar grouped in fours', () => {
    render(<CustomerFormDialog open onOpenChange={() => {}} customer={{ id: 'c1', name: 'Asha', phone: '9876543210', aadhaarNumber: '234123412346', panNumber: 'ABCDE1234F', gstin: null, leadStatus: 'NEW' } as unknown as CustomerDto} />);
    expect(input('aadhaarNumber').value).toBe('2341 2341 2346');
    expect(input('panNumber').value).toBe('ABCDE1234F');
  });
});
