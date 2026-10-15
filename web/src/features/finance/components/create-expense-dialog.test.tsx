import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayDateInput } from '@/features/delivery/components/delivery-date-field';
import { CreateExpenseDialog } from './create-expense-dialog';

const h = vi.hoisted(() => ({ create: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('../hooks', () => ({
  useFinanceMutations: () => ({ createExpense: { mutateAsync: h.create, isPending: false } }),
  useCategories: () => ({ data: [{ id: 'cat1', name: 'Rent', active: true }] }),
  useVendors: () => ({ data: { data: [] } }),
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));
// Radix Select does not run in jsdom: a native <select> stands in (as in staff-list-page.test).
interface MockSelectProps { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({ value, onValueChange, children }: MockSelectProps) =>
      React.createElement('select', { value, 'aria-label': 'select', onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: MockSelectProps) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => React.createElement('option', { value }, children),
  };
});

const shift = (days: number): string => todayDateInput(new Date(Date.now() + days * 86_400_000));
const record = (): HTMLElement => screen.getByRole('button', { name: 'Record expense' });

beforeEach(() => { h.create.mockReset().mockResolvedValue({ expenseNumber: 'EXP-1' }); h.toastSuccess.mockReset(); h.toastError.mockReset(); });
afterEach(cleanup);

// QA M10: submitting an incomplete expense explained nothing, and the date could not be chosen.
describe('CreateExpenseDialog', () => {
  it('says what is missing, next to the fields, instead of doing nothing', () => {
    render(<CreateExpenseDialog open onOpenChange={() => {}} />);
    expect(screen.queryAllByRole('alert')).toHaveLength(0); // nothing shouted before the first attempt
    fireEvent.click(record());
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(expect.arrayContaining(['Select a category', 'Enter the amount']));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('defaults the expense date to today and lets it be back-dated, not future-dated', () => {
    render(<CreateExpenseDialog open onOpenChange={() => {}} />);
    const date = screen.getByLabelText('Expense date') as HTMLInputElement;
    expect(date.value).toBe(todayDateInput());
    expect(date.max).toBe(todayDateInput());
    fireEvent.change(date, { target: { value: shift(2) } });
    fireEvent.click(record());
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('The expense date cannot be in the future');
  });

  it('sends a back-dated expense with its date; today is left to the server', async () => {
    render(<CreateExpenseDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole('option', { name: 'Rent' }).closest('select')!, { target: { value: 'cat1' } });
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Expense date'), { target: { value: shift(-3) } });
    fireEvent.click(record());
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ categoryId: 'cat1', amount: 25000, expenseDate: new Date(shift(-3)) });

    cleanup();
    render(<CreateExpenseDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole('option', { name: 'Rent' }).closest('select')!, { target: { value: 'cat1' } });
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '99' } });
    fireEvent.click(record());
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(2));
    expect(h.create.mock.calls[1]![0].expenseDate).toBeUndefined();
  });
});
