import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UnitIdentityPolicy } from '@azad/shared';
import { InventoryDetailPage } from './inventory-detail-page';

const h = vi.hoisted(() => ({ perms: new Set<string>(), role: 'OWNER', identity: {} as unknown }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.has(p), user: { role: h.role } }) }));
vi.mock('../hooks', () => ({
  useUnit: () => ({
    isLoading: false,
    data: {
      id: 'u1', vin: 'VIN0001', motorNumber: 'MOT0001', batteryNumber: 'BAT0001', status: 'AVAILABLE', purchaseDate: null, purchaseCost: '0', sellingPrice: '0',
      supplier: null, location: null, notes: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      variant: { id: 'v1', name: 'Pro', colour: 'Teal', hexColour: null, model: { id: 'm1', brand: 'Azad', name: 'VX' } },
      identity: h.identity, events: [], photos: [], documents: [], bookings: [], sales: [], serviceJobs: [],
    },
  }),
  useDeleteUnit: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../components/unit-form-dialog', () => ({ UnitFormDialog: () => null }));
vi.mock('../components/change-status-dialog', () => ({ ChangeStatusDialog: () => null }));
vi.mock('../components/unit-media', () => ({ UnitMedia: () => null }));
vi.mock('../components/unit-timeline', () => ({ UnitTimeline: () => null }));
vi.mock('../components/identification-correction-dialog', () => ({
  IdentificationCorrectionDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Correct identification dialog" /> : null),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const eligible: UnitIdentityPolicy = { committed: true, catalogueEditable: false, identificationEditable: false, correctionEligible: true };
const notEligible: UnitIdentityPolicy = { committed: false, catalogueEditable: true, identificationEditable: true, correctionEligible: false };
const renderAs = (role: string, perms: string[], identity: UnitIdentityPolicy): void => {
  cleanup();
  h.role = role;
  h.perms = new Set(perms);
  h.identity = identity;
  render(<MemoryRouter initialEntries={['/inventory/u1']}><Routes><Route path="/inventory/:id" element={<InventoryDetailPage />} /></Routes></MemoryRouter>);
};
const correctButton = () => screen.queryByRole('button', { name: /Correct identification/ });

beforeEach(() => { h.perms = new Set(); });
afterEach(cleanup);

describe('InventoryDetailPage — identification correction action', () => {
  it('an OWNER with inventory.update sees it for an eligible vehicle, and it opens the correction dialog', () => {
    renderAs('OWNER', ['inventory.update'], eligible);
    fireEvent.click(correctButton()!);
    expect(screen.getByRole('dialog', { name: 'Correct identification dialog' })).toBeTruthy();
  });

  it('is hidden for non-owners, even with inventory.update', () => {
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) {
      renderAs(role, ['inventory.update', 'inventory.view', 'inventory.create'], eligible);
      expect(correctButton()).toBeNull();
    }
  });

  it('is hidden for an OWNER without inventory.update, and for a vehicle that is not eligible', () => {
    renderAs('OWNER', ['inventory.view'], eligible);
    expect(correctButton()).toBeNull();
    renderAs('OWNER', ['inventory.update'], notEligible);
    expect(correctButton()).toBeNull();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy(); // the ordinary edit is the path then
  });
});
