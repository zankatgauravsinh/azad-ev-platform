import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { SparePartDto } from '@azad/shared';
import { SparePartsPage } from './spare-parts-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p), useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));

const part = { id: 'p1', name: 'Brake Pad', sku: 'BP-1', quantity: 5, lowStock: false, cost: 100n, sellingPrice: 200n, warrantyMonths: 6 } as unknown as SparePartDto;
vi.mock('../hooks', () => ({
  // Mirror the real hook: data only when enabled (spareparts.view).
  useSpareParts: (_q: unknown, enabled: boolean) => ({ data: enabled ? { data: [part], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : undefined, isLoading: false, isFetching: false }),
  useServiceInvalidate: () => async () => {},
}));
vi.mock('../api', () => ({ serviceApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><SparePartsPage /></MemoryRouter>); };
const q = {
  partRow: () => screen.queryByText('Brake Pad'),
  add: () => screen.queryByRole('button', { name: /Add part/ }),
  plus: () => screen.queryByRole('button', { name: '+' }),
  del: () => screen.queryAllByRole('button').find((b) => b.className.includes('text-destructive')) ?? null,
};
beforeEach(() => { h.perms.current = new Set(); });

describe('SparePartsPage permission gating (view / manage / adjust independent)', () => {
  it('view-only: list readable, no manage or adjust controls', () => {
    renderWith(['spareparts.view']);
    expect(q.partRow()).not.toBeNull();
    expect(q.add()).toBeNull();
    expect(q.plus()).toBeNull();
    expect(q.del()).toBeNull();
  });

  it('manage (no adjust): Add part + Delete, but no +/− adjust', () => {
    renderWith(['spareparts.view', 'spareparts.manage']);
    expect(q.add()).not.toBeNull();
    expect(q.del()).not.toBeNull();
    expect(q.plus()).toBeNull();
  });

  it('adjust (no manage): +/− available, but no Add/Delete', () => {
    renderWith(['spareparts.view', 'spareparts.adjust']);
    expect(q.plus()).not.toBeNull();
    expect(q.add()).toBeNull();
    expect(q.del()).toBeNull();
  });

  it('manage + adjust: all controls present', () => {
    renderWith(['spareparts.view', 'spareparts.manage', 'spareparts.adjust']);
    expect(q.add()).not.toBeNull();
    expect(q.plus()).not.toBeNull();
    expect(q.del()).not.toBeNull();
  });

  it('no spareparts.view: list query disabled → no rows', () => {
    renderWith([]);
    expect(q.partRow()).toBeNull();
    expect(q.add()).toBeNull();
  });
});
