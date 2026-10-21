import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GstPage } from './gst-page';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ perms: { current: new Set<string>() }, navigate: vi.fn(), export: vi.fn(), saveBlob: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('@/lib/download', () => ({ saveBlob: (...a: any[]) => h.saveBlob(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../api', () => ({ gstApi: { export: (...a: any[]) => h.export(...a) } }));
vi.mock('../components/gst-filing-panel', () => ({ GstFilingPanel: (p: { canManage: boolean }) => <div data-testid="filing" data-can-manage={String(p.canManage)} /> }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>,
}));
const heads = (taxable: string, igst = '0', cgst = '0', sgst = '0') => ({ taxable, igst, cgst, sgst });
const overview = {
  period: '2026-09',
  gstr1: { documents: 3, totals: heads('20000000', '0', '500000', '500000') },
  gstr3b: {
    period: '2026-09', outwardTaxable: heads('20000000', '0', '500000', '500000'), outwardNilExempt: '0', interStateUnregistered: [], otherIncome: heads('0'),
    itc: { available: { igst: '0', cgst: '200000', sgst: '200000' }, reversed: { igst: '0', cgst: '0', sgst: '0' }, net: { igst: '0', cgst: '200000', sgst: '200000' }, notClaimable: { igst: '0', cgst: '0', sgst: '0' } },
    payment: { liability: { igst: '0', cgst: '500000', sgst: '500000' }, itcUsed: { igst: '0', cgst: '200000', sgst: '200000' }, cash: { igst: '0', cgst: '300000', sgst: '300000' } },
  },
  issues: { errors: 1, warnings: 0, info: 0 },
};
vi.mock('../hooks', () => ({
  useGstOverview: () => ({ data: overview, isLoading: false }),
  useGstIssues: () => ({ data: [{ code: 'INVOICE_WITHOUT_GST', severity: 'ERROR', message: 'Tax invoice INV0004 has no GST breakdown', reference: 'INV0004', link: { type: 'booking', id: 'b4' } }], isLoading: false }),
  useGstDocuments: () => ({ data: [], isLoading: false }),
  useGstr1: () => ({ data: undefined, isLoading: true }),
  useGstPurchases: () => ({ data: [], isLoading: false }),
}));

beforeEach(() => { h.perms.current = new Set(['gst.view']); h.export.mockReset().mockResolvedValue(new Blob(['x'])); h.navigate.mockReset(); });
afterEach(cleanup);

describe('GstPage', () => {
  it('needs gst.view', () => {
    h.perms.current = new Set();
    render(<GstPage />);
    expect(screen.getByText('You don’t have permission to view GST returns.')).toBeInTheDocument();
  });

  it('shows the month’s GSTR-3B figures, the cash to pay and that there is an error to fix', () => {
    render(<GstPage />);
    expect(screen.getByText('GST to pay in cash')).toBeInTheDocument();
    expect(screen.getByText('1 error to fix first')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Issues (1)' })).toBeInTheDocument();
  });

  it('purchases (tab and export) only with inventory.cost; filing managed only with gst.manage', () => {
    render(<GstPage />);
    expect(screen.queryByRole('tab', { name: /Purchases/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Purchase register' })).toBeNull();
    cleanup();
    h.perms.current = new Set(['gst.view', 'inventory.cost', 'gst.manage']);
    render(<GstPage />);
    expect(screen.getByRole('tab', { name: /Purchases/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase register' })).toBeInTheDocument();
  });

  it('exports the GSTR-1 Offline Tool workbook for the chosen month', async () => {
    render(<GstPage />);
    fireEvent.change(screen.getByLabelText('Return period'), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'GSTR-1 (GST Offline Tool Excel)' }));
    await waitFor(() => expect(h.export).toHaveBeenCalledWith('gstr1', '2026-08'));
    expect(h.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'GSTR1-2026-08.xlsx');
  });
});
