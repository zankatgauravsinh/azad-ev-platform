import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ServiceJobDto } from '@azad/shared';
import { ServiceListPage } from './service-list-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }), useCan: (p: string) => h.perms.current.has(p) }));

const row = { id: 'j1', code: 'JC-1', customer: { name: 'Asha', phone: '98' }, unit: { model: 'VX', variant: 'Pro', vin: 'V1' }, type: 'PAID', priority: 'MEDIUM', technician: null, status: 'DIAGNOSIS' } as unknown as ServiceJobDto;
vi.mock('../hooks', () => ({
  // Mirror the real hook: data only when enabled (service.view).
  useServiceJobs: (_q: unknown, enabled: boolean) => ({ data: enabled ? { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : undefined, isLoading: false, isFetching: false }),
}));
vi.mock('../components/service-job-form-dialog', () => ({ ServiceJobFormDialog: () => null }));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<MemoryRouter><ServiceListPage /></MemoryRouter>); };
const q = {
  jobRow: () => screen.queryByText('JC-1'),
  newJob: () => screen.queryByRole('button', { name: /New job card/ }),
  reports: () => screen.queryByRole('button', { name: /Reports/ }),
};
beforeEach(() => { h.perms.current = new Set(); });

describe('ServiceListPage permission gating', () => {
  it('service.view: reads the list, no create/reports controls', () => {
    renderWith(['service.view']);
    expect(q.jobRow()).not.toBeNull();
    expect(q.newJob()).toBeNull();
    expect(q.reports()).toBeNull();
  });

  it('service.create → New job card (independent from reports)', () => {
    renderWith(['service.view', 'service.create']);
    expect(q.newJob()).not.toBeNull();
    expect(q.reports()).toBeNull();
  });

  it('reports.view → Reports button (Batch 4 mapping preserved, independent from create)', () => {
    renderWith(['service.view', 'reports.view']);
    expect(q.reports()).not.toBeNull();
    expect(q.newJob()).toBeNull();
  });

  it('no service.view → list query disabled, no rows', () => {
    renderWith([]);
    expect(q.jobRow()).toBeNull();
    expect(q.newJob()).toBeNull();
  });
});
