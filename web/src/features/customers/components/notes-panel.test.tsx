import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotesPanel } from './notes-panel';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p) }));

const note = { id: 'n1', body: 'Hello', author: { name: 'Tej' }, updatedAt: new Date().toISOString(), editCount: 0 };
vi.mock('../hooks', () => ({ useCustomerNotes: () => ({ data: [note] }) }));
vi.mock('../api', () => ({ customersApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => {
  cleanup();
  h.perms.current = new Set(perms);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><NotesPanel customerId="c1" /></QueryClientProvider>);
};
beforeEach(() => { h.perms.current = new Set(); });

describe('NotesPanel — note mutation is gated by customers.update', () => {
  it('without customers.update: note is readable, but no add/edit/delete', () => {
    renderWith(['customers.view']);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();
  });

  it('with customers.update: add/edit/delete controls appear', () => {
    renderWith(['customers.view', 'customers.update']);
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByLabelText('Edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
  });
});
