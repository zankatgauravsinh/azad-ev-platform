import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WarrantyCoverageLine } from '@azad/shared';
import { WarrantyMonthsDialog } from './warranty-months-dialog';

const h = vi.hoisted(() => ({ revise: vi.fn(), certificate: vi.fn(), save: vi.fn(), toastError: vi.fn() }));
vi.mock('../hooks', () => ({ useWarrantyMutations: () => ({ reviseMonths: { mutateAsync: h.revise, isPending: false } }) }));
vi.mock('../api', () => ({ warrantyApi: { certificate: h.certificate } }));
vi.mock('@/lib/download', () => ({ saveBlob: h.save }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

const coverage: WarrantyCoverageLine[] = [
  { item: 'MOTOR', label: 'Motor', covered: true, remarks: null, months: 36, validUntil: '2029-01-01T00:00:00.000Z' },
  { item: 'BATTERY', label: 'Battery', covered: true, remarks: null, months: 60, validUntil: '2031-01-01T00:00:00.000Z' },
  { item: 'CHARGER', label: 'Charger', covered: false, remarks: null, months: null, validUntil: null },
  { item: 'CUSTOM', label: 'Hub bearings', covered: true, remarks: null, months: 18, validUntil: '2028-04-01T00:00:00.000Z' },
  // CONTROLLER missing (older card): shows the overall period.
];
const warranty = { id: 'w1', warrantyNumber: 'WR-1', periodMonths: 60 };
const input = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  h.revise.mockReset().mockResolvedValue({});
  h.certificate.mockReset().mockResolvedValue(new Blob(['%PDF']));
  h.save.mockReset();
  h.toastError.mockReset();
});
afterEach(cleanup);

describe('WarrantyMonthsDialog', () => {
  it('starts from the months on the card', () => {
    render(<WarrantyMonthsDialog open onOpenChange={() => {}} warranty={warranty} coverage={coverage} />);
    expect(input('Motor (months)').value).toBe('36');
    expect(input('Battery (months)').value).toBe('60');
    expect(input('Controller (months)').value).toBe('60');
    expect(input('Charger (months)').value).toBe('0');
    expect(input('Extra item 1 name').value).toBe('Hub bearings');
    expect(input('Extra item 1 months').value).toBe('18');
  });

  it('saves the new months, then downloads the regenerated card', async () => {
    const onOpenChange = vi.fn();
    render(<WarrantyMonthsDialog open onOpenChange={onOpenChange} warranty={warranty} coverage={coverage} />);
    fireEvent.change(input('Motor (months)'), { target: { value: '48' } });
    fireEvent.change(input('Charger (months)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Extended' } });
    // + adds an item of the owner's own; × removes one.
    fireEvent.click(screen.getByRole('button', { name: /Add warranty item/ }));
    fireEvent.change(input('Extra item 2 name'), { target: { value: 'Side mirror' } });
    fireEvent.change(input('Extra item 2 months'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Add warranty item/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove extra item 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & regenerate' }));
    await waitFor(() =>
      expect(h.revise).toHaveBeenCalledWith({
        id: 'w1',
        body: { months: { MOTOR: 48, BATTERY: 60, CONTROLLER: 60, CHARGER: 12 }, extras: [{ name: 'Hub bearings', months: 18 }, { name: 'Side mirror', months: 6 }], reason: 'Extended' },
      }),
    );
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.any(Blob), 'warranty-WR-1.pdf'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses months out of range, or a card that covers nothing', async () => {
    render(<WarrantyMonthsDialog open onOpenChange={() => {}} warranty={warranty} coverage={coverage} />);
    fireEvent.change(input('Motor (months)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & regenerate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('240');
    for (const label of ['Motor', 'Battery', 'Controller', 'Charger']) fireEvent.change(input(`${label} (months)`), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & regenerate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cover at least one component');
    expect(h.revise).not.toHaveBeenCalled();
  });
});
