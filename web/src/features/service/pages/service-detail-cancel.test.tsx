import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SYSTEM_ROLE_PERMISSIONS, type Role, type ServiceJobDto } from '@azad/shared';
import { ServiceDetailPage } from './service-detail-page';

const h = vi.hoisted(() => ({
  user: { current: { id: 'u1', role: 'MANAGER' } as { id: string; role: string } },
  perms: { current: new Set<string>() },
  job: { current: null as unknown },
  changeStatus: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, serviceApi: { ...actual.serviceApi, changeStatus: (...a: unknown[]) => h.changeStatus(...a) } };
});

// Permission-driven (Batch 5): the page reads can() from /auth/me effective permissions.
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: h.user.current, can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('../hooks', () => ({
  useServiceJob: () => ({ data: h.job.current, isLoading: false }),
  useLabourItems: () => ({ data: [] }),
  useServiceInvalidate: () => async () => {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const job = {
  id: 'j1',
  code: 'JC-1',
  status: 'DIAGNOSIS',
  priority: 'MEDIUM',
  type: 'REPAIR',
  underWarranty: false,
  unit: { model: 'VX', variant: 'Pro', colour: 'Red', vin: 'VIN123' },
  customer: { name: 'Asha', phone: '9876543210' },
  technician: { id: 't1', name: 'Tej' },
  complaints: [],
  warrantyStatus: { vehicle: { months: 12, active: false, endDate: null, daysRemaining: 0 } },
  parts: [],
  labour: [],
  bill: { partsTotal: 0n, labourTotal: 0n, discount: 0n, taxAmount: 0n, total: 0n, paid: 0n, balance: 0n, status: 'PENDING' },
  inspection: [],
  feedbackRating: null,
  feedbackNote: null,
} as unknown as ServiceJobDto;

const renderAs = (role: string): void => {
  h.user.current = { id: 'u1', role };
  h.perms.current = new Set(SYSTEM_ROLE_PERMISSIONS[role as Role] ?? []);
  h.job.current = job;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/service/j1']}>
        <Routes>
          <Route path="/service/:id" element={<ServiceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);
beforeEach(() => { h.changeStatus.mockReset().mockResolvedValue({}); });

// QA M7: cancelling a job card is irreversible, so it is confirmed with a reason.
describe('ServiceDetailPage — cancelling a job card', () => {
  it('asks for a reason before cancelling, and sends it', async () => {
    renderAs('MANAGER');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    expect(h.changeStatus).not.toHaveBeenCalled(); // one click no longer cancels
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Cancel job card JC-1?');
    const confirm = screen.getByRole('button', { name: 'Cancel job card' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer withdrew the vehicle' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(h.changeStatus).toHaveBeenCalledWith('j1', 'CANCELLED', 'Customer withdrew the vehicle'));
  });

  it('other status moves still happen in one click', async () => {
    renderAs('MANAGER');
    fireEvent.click(screen.getByRole('button', { name: 'Repairing' }));
    await waitFor(() => expect(h.changeStatus).toHaveBeenCalledWith('j1', 'REPAIRING'));
  });

  it('keeping the job card cancels nothing', () => {
    renderAs('MANAGER');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep job card' }));
    expect(h.changeStatus).not.toHaveBeenCalled();
  });
});
