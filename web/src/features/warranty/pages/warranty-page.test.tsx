import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { WarrantyPage } from './warranty-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }), useCan: (p: string) => h.perms.current.has(p) }));

const emptyList = { data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }, isLoading: false, isFetching: false };
vi.mock('../hooks', () => ({
  useWarrantyDashboard: () => ({ data: undefined }),
  useWarranties: () => emptyList,
  useClaims: () => emptyList,
  useAmcPlans: () => emptyList,
  useWarrantyMutations: () => ({ generate: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('../components/create-warranty-dialog', () => ({ CreateWarrantyDialog: () => null }));
vi.mock('../components/create-amc-dialog', () => ({ CreateAmcDialog: () => null }));
vi.mock('../components/warranty-detail-dialog', () => ({ WarrantyDetailDialog: () => null }));
vi.mock('../components/amc-detail-dialog', () => ({ AmcDetailDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><WarrantyPage /></MemoryRouter>); };
const q = {
  generate: () => screen.queryByRole('button', { name: 'Generate' }),
  newWarranty: () => screen.queryByRole('button', { name: /New warranty/ }),
  newAmc: () => screen.queryByRole('button', { name: /New AMC/ }),
  tabWarranties: () => screen.queryByRole('tab', { name: 'Warranties' }),
  tabClaims: () => screen.queryByRole('tab', { name: 'Claims' }),
  tabAmc: () => screen.queryByRole('tab', { name: 'AMC' }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('WarrantyPage permission gating', () => {
  it('view-only (warranty+claims+amc view): all tabs, no create actions', () => {
    renderWith(['warranty.view', 'claims.view', 'amc.view']);
    expect(q.tabWarranties()).not.toBeNull();
    expect(q.tabClaims()).not.toBeNull();
    expect(q.tabAmc()).not.toBeNull();
    expect(q.generate()).toBeNull();
    expect(q.newWarranty()).toBeNull();
    expect(q.newAmc()).toBeNull();
  });

  it('warranty.create → Generate + New warranty (not New AMC)', () => {
    renderWith(['warranty.view', 'claims.view', 'amc.view', 'warranty.create']);
    expect(q.generate()).not.toBeNull();
    expect(q.newWarranty()).not.toBeNull();
    expect(q.newAmc()).toBeNull();
  });

  it('amc.manage → New AMC (not Generate / New warranty)', () => {
    renderWith(['warranty.view', 'claims.view', 'amc.view', 'amc.manage']);
    expect(q.newAmc()).not.toBeNull();
    expect(q.generate()).toBeNull();
    expect(q.newWarranty()).toBeNull();
  });

  it('a custom role with only warranty.view sees just the Warranties tab, no create', () => {
    renderWith(['warranty.view']);
    expect(q.tabWarranties()).not.toBeNull();
    expect(q.tabClaims()).toBeNull();
    expect(q.tabAmc()).toBeNull();
    expect(q.generate()).toBeNull();
    expect(q.newWarranty()).toBeNull();
    expect(q.newAmc()).toBeNull();
  });

  it('a custom role with only amc.view + amc.manage sees just the AMC tab + New AMC', () => {
    renderWith(['amc.view', 'amc.manage']);
    expect(q.tabAmc()).not.toBeNull();
    expect(q.tabWarranties()).toBeNull();
    expect(q.tabClaims()).toBeNull();
    expect(q.newAmc()).not.toBeNull();
    expect(q.newWarranty()).toBeNull();
  });
});
