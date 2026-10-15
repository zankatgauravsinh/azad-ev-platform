import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { CustomerCombobox } from './customer-combobox';

const asha = { id: 'c1', name: 'Asha Patel', phone: '9876543210' };
vi.mock('@/features/customers/api', () => ({
  customersApi: { list: async () => ({ data: [asha] }), getById: async (id: string) => (id === 'c1' ? asha : null) },
}));

afterEach(cleanup);
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

function Picker({ initial = '' }: { initial?: string }): JSX.Element {
  const [value, setValue] = useState(initial);
  return <><Label htmlFor="cust">Customer</Label><CustomerCombobox id="cust" value={value} onChange={setValue} /></>;
}

// QA (Low): the picker said "Customer selected" instead of who was picked.
describe('CustomerCombobox', () => {
  it('shows the picked customer by name and mobile, and is named by its label', async () => {
    wrap(<Picker />);
    const trigger = screen.getByLabelText('Customer');
    expect(trigger).toHaveTextContent('Select customer');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: /Asha Patel/ }));
    expect(trigger).toHaveTextContent('Asha Patel · 9876543210');
  });

  it('shows a customer the form opened with', async () => {
    wrap(<Picker initial="c1" />);
    expect(await screen.findByText('Asha Patel · 9876543210')).toBeInTheDocument();
  });
});
