import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GstFilingPanel } from './gst-filing-panel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ filings: { current: [] as any[] }, markFiled: vi.fn(), unlock: vi.fn() }));
vi.mock('../hooks', () => ({
  useGstFilings: () => ({ data: h.filings.current, isLoading: false }),
  useGstFilingMutations: () => ({ markFiled: { mutateAsync: h.markFiled, isPending: false }, unlock: { mutateAsync: h.unlock, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const filing = (over: Record<string, unknown>) => ({ returnType: 'GSTR1', status: 'NOT_FILED', arn: null, filedOn: null, filedBy: null, notes: null, unlockedAt: null, unlockReason: null, changesSinceFiling: [], ...over });

beforeEach(() => {
  h.markFiled.mockReset().mockResolvedValue([]);
  h.unlock.mockReset().mockResolvedValue([]);
  h.filings.current = [filing({}), filing({ returnType: 'GSTR3B' })];
});
afterEach(cleanup);

describe('GstFilingPanel', () => {
  it('marks GSTR-1 filed with the ARN and date; warns when errors remain', async () => {
    render(<GstFilingPanel period="2026-09" periodLabel="September 2026" canManage errors={2} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Mark filed/ })[0]!);
    expect(screen.getByRole('alert')).toHaveTextContent('2 issues still marked as errors');
    fireEvent.change(screen.getByLabelText('ARN (from the portal)'), { target: { value: 'aa2409250123456' } });
    fireEvent.change(screen.getByLabelText('Filed on'), { target: { value: '2026-10-11' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark filed' }).at(-1)!);
    await waitFor(() => expect(h.markFiled).toHaveBeenCalledWith({ period: '2026-09', returnType: 'GSTR1', arn: 'AA2409250123456', filedOn: '2026-10-11', notes: undefined }));
  });

  it('a filed return shows its ARN and what changed since filing; unlocking needs a reason', async () => {
    h.filings.current = [filing({ status: 'FILED', arn: 'AA2409250123456', filedOn: '2026-10-11', filedBy: 'Owner', changesSinceFiling: [{ label: 'Taxable value', filed: '100000', now: '200000' }] }), filing({ returnType: 'GSTR3B' })];
    render(<GstFilingPanel period="2026-09" periodLabel="September 2026" canManage errors={0} />);
    expect(screen.getByText('AA2409250123456')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Taxable value: ₹1,000.00 → ₹2,000.00');
    fireEvent.click(screen.getByRole('button', { name: /Unlock/ }));
    const confirm = screen.getAllByRole('button', { name: 'Unlock' }).at(-1)! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong rate on one bill' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(h.unlock).toHaveBeenCalledWith({ period: '2026-09', returnType: 'GSTR1', reason: 'Wrong rate on one bill' }));
  });

  it('without gst.manage the status is shown read-only', () => {
    render(<GstFilingPanel period="2026-09" periodLabel="September 2026" canManage={false} errors={0} />);
    expect(screen.getAllByText('Not filed')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Mark filed/ })).toBeNull();
  });
});
