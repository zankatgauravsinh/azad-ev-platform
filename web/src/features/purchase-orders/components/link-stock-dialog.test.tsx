import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LinkStockDialog } from './link-stock-dialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ candidates: { current: [] as any[] }, link: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: h.candidates.current, isLoading: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../api', () => ({ purchaseOrdersApi: { linkStock: (...a: any[]) => h.link(...a) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const candidate = (vin: string, over: Record<string, unknown> = {}) => ({ id: `id-${vin}`, vin, status: 'AVAILABLE', addedOn: '2026-10-20T10:00:00Z', purchaseDate: null, vendorName: null, purchasePrice: '0', purchaseGst: '0', costMissing: true, costDiffers: false, ...over });
const line = { orderId: 'po1', lineId: 'l1', poNumber: 'PO0005', description: 'Ampus 0 Black', remaining: 2, unitCost: '7000000', gstRateBp: 500 };

beforeEach(() => { h.link.mockReset().mockResolvedValue({}); h.candidates.current = [candidate('VIN1'), candidate('VIN2'), candidate('VIN3', { costMissing: false, purchasePrice: '6900000', purchaseGst: '345000', costDiffers: true, vendorName: 'Comptech' })]; });
afterEach(cleanup);

describe('LinkStockDialog', () => {
  it('picks up to what the line still expects and links them', async () => {
    render(<LinkStockDialog line={line} onClose={() => {}} />);
    expect(screen.getAllByText(/No purchase price yet — the order’s price and GST will be used/)).toHaveLength(2);
    expect(screen.getByText(/Keeps its own price ₹69,000.00 \+ GST ₹3,450.00 \(differs from the order\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('VIN1'));
    fireEvent.click(screen.getByLabelText('VIN2'));
    expect((screen.getByLabelText('VIN3') as HTMLInputElement).disabled).toBe(true); // 2 still expected
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 scooters' }));
    await waitFor(() => expect(h.link).toHaveBeenCalledWith('po1', 'l1', { unitIds: ['id-VIN1', 'id-VIN2'] }));
  });

  it('says so when nothing in stock can be linked', () => {
    h.candidates.current = [];
    render(<LinkStockDialog line={line} onClose={() => {}} />);
    expect(screen.getByText(/No scooter of this model in stock can be linked/)).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Link scooters' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
