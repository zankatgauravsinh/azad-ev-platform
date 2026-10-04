import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { TaxClassificationDto } from '@azad/shared';
import { GstManagementPage } from './gst-management-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const taxable: TaxClassificationDto = {
  id: 't1', name: 'EV Scooter', codeType: 'HSN', code: '8711', treatment: 'TAXABLE', description: 'Electric two-wheeler',
  isActive: true, createdAt: '', updatedAt: '',
  rates: [{ id: 'r1', classificationId: 't1', ratePercent: '5.00', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, isActive: true, createdAt: '' }],
};
const exempt: TaxClassificationDto = {
  id: 't2', name: 'RTO Fee', codeType: 'SAC', code: null, treatment: 'NON_TAXABLE', description: null,
  isActive: true, createdAt: '', updatedAt: '', rates: [],
};

vi.mock('../hooks', () => ({
  useTaxClassifications: () => ({ data: [taxable, exempt], isLoading: false, isFetching: false }),
  useTaxMutations: () => ({ removeClassification: { mutateAsync: vi.fn() } }),
}));
vi.mock('../components/classification-form-dialog', () => ({ ClassificationFormDialog: (p: { open: boolean }) => (p.open ? <div data-testid="class-form" /> : null) }));
vi.mock('../components/rates-dialog', () => ({ RatesDialog: (p: { open: boolean }) => (p.open ? <div data-testid="rates" /> : null) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  type P = { children?: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; className?: string };
  return {
    DropdownMenu: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, onClick, className }: P) => React.createElement('button', { type: 'button', onClick, className }, children),
    DropdownMenuSeparator: () => null,
  };
});

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><GstManagementPage /></MemoryRouter>); };
beforeEach(() => { h.perms.current = new Set(); });

describe('GstManagementPage', () => {
  it('blocks users without settings.view', () => {
    renderWith([]);
    expect(screen.getByText(/don’t have permission to view GST/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('view-only: lists classifications with treatment + current rate, no edit controls', () => {
    renderWith(['settings.view']);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('EV Scooter');
    expect(table).toHaveTextContent('RTO Fee');
    expect(screen.getByText('5.00%')).toBeInTheDocument(); // taxable current rate
    expect(screen.getByText('Non Taxable')).toBeInTheDocument(); // treatment label
    expect(screen.queryByRole('button', { name: /New classification/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage rates' })).toBeNull();
  });

  it('settings.manage: can create and manage', () => {
    renderWith(['settings.view', 'settings.manage']);
    expect(screen.getByRole('button', { name: /New classification/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New classification/ }));
    expect(screen.getByTestId('class-form')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Manage rates' }).length).toBe(2);
  });
});
