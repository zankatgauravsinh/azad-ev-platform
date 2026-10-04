import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode, MouseEventHandler } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QuotationsListPage } from './quotations-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const row = { id: 'q1', code: 'QT-1', customer: { name: 'Asha', phone: '98' }, variant: { name: 'Pro', model: { name: 'VX' } }, total: 1000n, status: 'DRAFT', booking: null };
vi.mock('../hooks', () => ({
  useQuotations: () => ({ data: { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isLoading: false, isFetching: false }),
  useSalesInvalidate: () => () => {},
}));
vi.mock('../components/quotation-form-dialog', () => ({ QuotationFormDialog: () => null }));
vi.mock('../components/convert-quotation-dialog', () => ({ ConvertQuotationDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  type P = { children?: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement> };
  return {
    DropdownMenu: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuContent: ({ children }: P) => React.createElement('div', null, children),
    DropdownMenuItem: ({ children, onClick }: P) => React.createElement('button', { type: 'button', onClick }, children),
  };
});

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><QuotationsListPage /></MemoryRouter>); };
const q = {
  create: () => screen.queryByRole('button', { name: /New quotation/ }),
  duplicate: () => screen.queryByRole('button', { name: 'Duplicate' }),
  convert: () => screen.queryByRole('button', { name: /Convert to booking/ }),
  markSent: () => screen.queryByRole('button', { name: /Mark Sent/ }),
  pdf: () => screen.queryByRole('button', { name: /Download PDF/ }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('QuotationsListPage permission gating', () => {
  it('view-only: can read (PDF) but no create/convert/update', () => {
    renderWith(['quotations.view']);
    expect(q.pdf()).not.toBeNull();
    expect(q.create()).toBeNull();
    expect(q.duplicate()).toBeNull();
    expect(q.convert()).toBeNull();
    expect(q.markSent()).toBeNull();
  });
  it('quotations.create → New quotation + Duplicate', () => {
    renderWith(['quotations.view', 'quotations.create']);
    expect(q.create()).not.toBeNull();
    expect(q.duplicate()).not.toBeNull();
    expect(q.convert()).toBeNull();
  });
  it('quotations.convert → Convert only', () => {
    renderWith(['quotations.view', 'quotations.convert']);
    expect(q.convert()).not.toBeNull();
    expect(q.create()).toBeNull();
    expect(q.markSent()).toBeNull();
  });
  it('quotations.update → Mark Sent only', () => {
    renderWith(['quotations.view', 'quotations.update']);
    expect(q.markSent()).not.toBeNull();
    expect(q.convert()).toBeNull();
    expect(q.duplicate()).toBeNull();
  });
});
