import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import { ClassificationFormDialog } from './classification-form-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toastError: vi.fn() }));
vi.mock('../hooks', () => ({
  useTaxMutations: () => ({ createClassification: { mutateAsync: h.create }, updateClassification: { mutateAsync: h.update } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

// Native <select> stand-in so treatment/codeType are driveable in jsdom.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode; 'aria-label'?: string };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

beforeEach(() => { h.create.mockReset().mockResolvedValue({ id: 'c1' }); h.update.mockReset().mockResolvedValue({ id: 'c1' }); h.toastError.mockReset(); });
afterEach(cleanup);

const nameInput = () => document.querySelector('input[name="name"]') as HTMLInputElement;
const codeInput = () => document.querySelector('input[name="code"]') as HTMLInputElement;

describe('ClassificationFormDialog', () => {
  it('blocks a TAXABLE classification without a code and does not submit', async () => {
    render(<ClassificationFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(nameInput(), { target: { value: 'EV Scooter' } });
    // default treatment = TAXABLE, code empty
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.create).not.toHaveBeenCalled();
  });

  it('creates a taxable classification with a code', async () => {
    render(<ClassificationFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(nameInput(), { target: { value: 'EV Scooter' } });
    fireEvent.change(codeInput(), { target: { value: '8711' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ name: 'EV Scooter', codeType: 'HSN', code: '8711', treatment: 'TAXABLE', isActive: true });
  });

  it('allows a non-taxable classification with no code', async () => {
    render(<ClassificationFormDialog open onOpenChange={() => {}} />);
    fireEvent.change(nameInput(), { target: { value: 'RTO Fee' } });
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'NON_TAXABLE' } }); // treatment select
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ treatment: 'NON_TAXABLE', code: null });
  });
});
