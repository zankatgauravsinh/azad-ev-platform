import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SYSTEM_ROLE_PERMISSIONS, type Role, type ServiceJobDto } from '@azad/shared';
import { ServiceDetailPage } from './service-detail-page';

const h = vi.hoisted(() => ({
  user: { current: { id: 'u1', role: 'MANAGER' } as { id: string; role: string } },
  perms: { current: new Set<string>() },
  job: { current: null as unknown },
}));

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

const workflowControls = () => ({
  saveInspection: screen.queryByRole('button', { name: 'Save inspection' }),
  addComplaint: screen.queryByPlaceholderText('Add complaint'),
  addLabour: screen.queryByText('Add labour from catalogue…'),
});
const billControls = () => ({
  generateBill: screen.queryByRole('button', { name: 'Generate bill' }),
  takePayment: screen.queryByRole('button', { name: 'Take payment' }),
});

beforeEach(() => {
  h.user.current = { id: 'u1', role: 'MANAGER' };
});

describe('ServiceDetailPage authorization gating', () => {
  it('SALES_EXECUTIVE sees the job read-only — no workflow or billing mutation controls', () => {
    renderAs('SALES_EXECUTIVE');
    expect(screen.getByText('JC-1')).toBeInTheDocument(); // can read the job
    expect(screen.getByText('Balance')).toBeInTheDocument(); // bill summary is readable
    const wf = workflowControls();
    expect(wf.saveInspection).toBeNull();
    expect(wf.addComplaint).toBeNull();
    expect(wf.addLabour).toBeNull();
    const bill = billControls();
    expect(bill.generateBill).toBeNull();
    expect(bill.takePayment).toBeNull();
  });

  it('MANAGER sees workflow and billing controls', () => {
    renderAs('MANAGER');
    const wf = workflowControls();
    expect(wf.saveInspection).not.toBeNull();
    expect(wf.addComplaint).not.toBeNull();
    expect(wf.addLabour).not.toBeNull();
    const bill = billControls();
    expect(bill.generateBill).not.toBeNull();
    expect(bill.takePayment).not.toBeNull();
  });

  it('TECHNICIAN sees workflow controls but NOT billing controls', () => {
    renderAs('TECHNICIAN');
    expect(workflowControls().saveInspection).not.toBeNull();
    const bill = billControls();
    expect(bill.generateBill).toBeNull();
    expect(bill.takePayment).toBeNull();
  });
});

// Each service permission gates its own control, with no implication between them.
describe('ServiceDetailPage per-permission independence (custom roles)', () => {
  const renderPerms = (perms: string[]): void => {
    cleanup();
    h.perms.current = new Set(perms);
    h.job.current = job;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/service/j1']}>
          <Routes><Route path="/service/:id" element={<ServiceDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };
  const c = {
    complaint: () => screen.queryByPlaceholderText('Add complaint'),
    saveInspection: () => screen.queryByRole('button', { name: 'Save inspection' }),
    partsPicker: () => screen.queryByPlaceholderText('Search spare part to add…'),
    labourPicker: () => screen.queryByText('Add labour from catalogue…'),
    generateBill: () => screen.queryByRole('button', { name: 'Generate bill' }),
    takePayment: () => screen.queryByRole('button', { name: 'Take payment' }),
  };

  it('service.view only → no mutation controls at all', () => {
    renderPerms(['service.view']);
    expect(c.complaint()).toBeNull();
    expect(c.saveInspection()).toBeNull();
    expect(c.partsPicker()).toBeNull();
    expect(c.labourPicker()).toBeNull();
    expect(c.generateBill()).toBeNull();
    expect(c.takePayment()).toBeNull();
  });

  it('service.workflow → complaints/inspection only (not parts/labour/bill/payment)', () => {
    renderPerms(['service.view', 'service.workflow']);
    expect(c.complaint()).not.toBeNull();
    expect(c.saveInspection()).not.toBeNull();
    expect(c.partsPicker()).toBeNull();
    expect(c.labourPicker()).toBeNull();
    expect(c.generateBill()).toBeNull();
    expect(c.takePayment()).toBeNull();
  });

  it('service.create alone does NOT expose workflow controls', () => {
    renderPerms(['service.view', 'service.create']);
    expect(c.complaint()).toBeNull();
    expect(c.saveInspection()).toBeNull();
  });

  it('service.parts (+ spareparts.view) → parts picker only; workflow/labour hidden', () => {
    renderPerms(['service.view', 'service.parts', 'spareparts.view']);
    expect(c.partsPicker()).not.toBeNull();
    expect(c.complaint()).toBeNull();
    expect(c.labourPicker()).toBeNull();
  });

  it('spareparts.view WITHOUT service.parts → parts picker hidden (catalog read ≠ mutation)', () => {
    renderPerms(['service.view', 'spareparts.view']);
    expect(c.partsPicker()).toBeNull();
  });

  it('service.labour (+ labour.view) → labour picker only; parts hidden', () => {
    renderPerms(['service.view', 'service.labour', 'labour.view']);
    expect(c.labourPicker()).not.toBeNull();
    expect(c.partsPicker()).toBeNull();
  });

  it('labour.view WITHOUT service.labour → labour picker hidden (catalog read ≠ mutation)', () => {
    renderPerms(['service.view', 'labour.view']);
    expect(c.labourPicker()).toBeNull();
  });

  it('service.bill → Generate bill only (not Take payment)', () => {
    renderPerms(['service.view', 'service.bill']);
    expect(c.generateBill()).not.toBeNull();
    expect(c.takePayment()).toBeNull();
  });

  it('service.payment → Take payment only (not Generate bill)', () => {
    renderPerms(['service.view', 'service.payment']);
    expect(c.takePayment()).not.toBeNull();
    expect(c.generateBill()).toBeNull();
  });
});
