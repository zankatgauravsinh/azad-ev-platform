import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RecordHistory } from './record-history';

const h = vi.hoisted(() => ({ calls: [] as { enabled: boolean; type: string; id: string | undefined }[], error: false }));
vi.mock('../hooks', () => ({
  useAuditHistory: (type: string, id: string | undefined, _page: number, enabled: boolean) => {
    h.calls.push({ type, id, enabled });
    if (h.error) return { data: undefined, isLoading: false, isError: true };
    return {
      data: {
        data: [{ id: 'e1', createdAt: '2026-10-21T10:00:00.000Z', action: 'STATUS_CHANGE', source: 'USER', entityType: 'Booking', entityId: 'b1', entityLabel: 'BK1', summary: 'Confirmed booking BK1', changes: { status: { from: 'DRAFT', to: 'CONFIRMED' } }, metadata: null, reason: null, actor: { id: 'u1', name: 'Ravi', role: 'OWNER' }, ip: null, userAgent: null, requestId: null }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
    };
  },
}));

beforeEach(() => { h.calls = []; h.error = false; });
afterEach(cleanup);

describe('RecordHistory', () => {
  it('in a tab: loads at once and shows who changed what', () => {
    render(<MemoryRouter><RecordHistory entityType="Booking" entityId="b1" /></MemoryRouter>);
    expect(h.calls.at(-1)).toEqual({ type: 'Booking', id: 'b1', enabled: true });
    expect(screen.getByText('Ravi')).toBeTruthy();
    expect(screen.getByText('Confirmed booking BK1')).toBeTruthy();
    expect(screen.getByText('CONFIRMED')).toBeTruthy();
  });

  it('as a card: loads only when opened', () => {
    render(<MemoryRouter><RecordHistory entityType="Booking" entityId="b1" collapsible /></MemoryRouter>);
    expect(h.calls.every((c) => !c.enabled)).toBe(true);
    expect(screen.queryByText('Ravi')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show who changed what' }));
    expect(h.calls.at(-1)!.enabled).toBe(true);
    expect(screen.getByText('Ravi')).toBeTruthy();
  });

  it('a refused request says so plainly', () => {
    h.error = true;
    render(<MemoryRouter><RecordHistory entityType="Vendor" entityId="v1" /></MemoryRouter>);
    expect(screen.getByText('History is not available to you.')).toBeTruthy();
  });
});
