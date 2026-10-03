import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceReportsPage } from './service-reports-page';

const h = vi.hoisted(() => ({ perms: { current: new Set<string>() } }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.current.has(p) }));

const report = {
  revenue: { jobs: 3, billed: 1000n, collected: 800n, partsRevenue: 400n, labourRevenue: 600n },
  warranty: { warrantyJobs: 1, warrantyParts: 2 },
  daily: { created: 1, delivered: 1, collected: 100n },
  technicians: [],
  topReplacedParts: [],
  repeatComplaints: [],
};
vi.mock('../hooks', () => ({
  // Mirror the real hook: data only when enabled (reports.view).
  useServiceReports: (enabled: boolean) => ({ data: enabled ? report : undefined, isLoading: false }),
}));

const renderWith = (perms: string[]): void => { cleanup(); h.perms.current = new Set(perms); render(<ServiceReportsPage />); };
beforeEach(() => { h.perms.current = new Set(); });

describe('ServiceReportsPage gating (reports.view)', () => {
  it('reports.view → renders the report', () => {
    renderWith(['reports.view']);
    expect(screen.getByText('Delivered jobs')).toBeInTheDocument();
    expect(screen.getByText('Technician performance')).toBeInTheDocument();
  });

  it('without reports.view → shows a no-permission message, not the report', () => {
    renderWith([]);
    expect(screen.getByText(/don’t have permission to view service reports/)).toBeInTheDocument();
    expect(screen.queryByText('Delivered jobs')).toBeNull();
  });
});
