import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChangeEvent, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AuditEntryDto } from '@azad/shared';
import { AuditLogPage } from './audit-log-page';

const h = vi.hoisted(() => ({ perms: new Set<string>(), queries: [] as Record<string, unknown>[], exportFn: vi.fn(), saved: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useCan: (p: string) => h.perms.has(p) }));
vi.mock('../hooks', () => ({
  useAuditLog: (q: Record<string, unknown>) => {
    h.queries.push(q);
    return { data: { data: rows, meta: { page: 1, pageSize: 25, total: rows.length, totalPages: 1 } }, isLoading: false, isFetching: false, isError: false };
  },
  useAuditFacets: () => ({ data: { actors: [{ id: 'u1', name: 'Asha' }], entityTypes: ['Booking', 'bookings', 'Vendor'] } }),
}));
vi.mock('../api', () => ({ auditApi: { export: (...a: unknown[]) => h.exportFn(...a) } }));
vi.mock('@/lib/download', () => ({ saveBlob: (...a: unknown[]) => h.saved(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type P = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  return {
    Select: ({ value, onValueChange, children }: P) => React.createElement('select', { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: P) => React.createElement('option', { value }, children),
  };
});

const entry = (over: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: 'e1', createdAt: '2026-10-21T10:00:00.000Z', action: 'UPDATE', source: 'USER', entityType: 'Booking', entityId: '11111111-1111-4111-8111-111111111111',
  entityLabel: 'BK0030', summary: 'Changed discount', changes: { discount: { from: '0', to: '500000' } }, metadata: null, reason: null,
  actor: { id: 'u1', name: 'Asha', role: 'MANAGER' }, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', requestId: 'req-1', ...over,
});
const rows: AuditEntryDto[] = [entry({}), entry({ id: 'e2', action: 'CREATE', source: 'AUTO', entityType: 'finance', entityLabel: null, summary: 'POST /finance/categories', changes: null })];
const renderPage = () => render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
const selectWith = (text: string): HTMLSelectElement => screen.getAllByRole('combobox').find((s) => s.textContent?.includes(text)) as HTMLSelectElement;

beforeEach(() => {
  h.perms = new Set(['audit.view']);
  h.queries = [];
  h.exportFn.mockReset().mockResolvedValue(new Blob(['x']));
  h.saved.mockReset();
});
afterEach(cleanup);

describe('AuditLogPage', () => {
  it('without audit.view it shows nothing of the log', () => {
    h.perms = new Set();
    renderPage();
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.queryByText('BK0030')).toBeNull();
  });

  it('lists who did what to which record; automatic entries are marked', () => {
    renderPage();
    expect(screen.getAllByText('Asha').length).toBeGreaterThan(0);
    expect(screen.getByText('BK0030')).toBeTruthy();
    expect(screen.getByText('Changed discount')).toBeTruthy();
    expect(screen.getAllByText('Automatic record').some((el) => el.tagName === 'SPAN')).toBe(true); // the badge (also a Source filter option)
    expect(h.queries.at(-1)).toMatchObject({ page: 1, pageSize: 25, from: expect.any(String), to: expect.any(String) });
  });

  it('filters reach the query: person, action, record type (one choice per label)', () => {
    renderPage();
    fireEvent.change(selectWith('Everyone'), { target: { value: 'u1' } });
    fireEvent.change(selectWith('All actions'), { target: { value: 'DELETE' } });
    const types = selectWith('All records');
    expect([...types.options].filter((o) => o.textContent === 'Booking')).toHaveLength(1); // "Booking" and "bookings" share a label
    fireEvent.change(types, { target: { value: 'Vendor' } });
    expect(h.queries.at(-1)).toMatchObject({ actorId: 'u1', action: 'DELETE', entityType: 'Vendor', page: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(h.queries.at(-1)).toMatchObject({ from: undefined, to: undefined });
  });

  it('a row opens the full entry: changes in rupees, IP and device', () => {
    renderPage();
    fireEvent.click(screen.getByText('Changed discount'));
    expect(screen.getByText('What changed')).toBeTruthy();
    expect(screen.getByLabelText('Changes').textContent).toMatch(/Discount₹0₹5,000/);
    expect(screen.getByText('203.0.113.9')).toBeTruthy();
    expect(screen.getByText('Chrome on Windows')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open record/ }).getAttribute('href')).toBe('/bookings/11111111-1111-4111-8111-111111111111');
  });

  it('exports with the current filters', async () => {
    renderPage();
    fireEvent.change(selectWith('All actions'), { target: { value: 'LOGIN' } });
    fireEvent.click(screen.getByRole('button', { name: /Excel/ }));
    await waitFor(() => expect(h.exportFn).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN' }), 'xlsx'));
    await waitFor(() => expect(h.saved).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^audit-log-.*\.xlsx$/)));
  });
});
