import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/**
 * Batch 3 nav — the single "Warranty & AMC" entry is gated by warranty.view (the three view
 * permissions share the same role set in the seed; per-tab view gating lives on the page).
 */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

describe('Batch 3 nav — Warranty & AMC', () => {
  it('carries permission warranty.view and no legacy roles list', () => {
    const item = NAV_ITEMS.find((i) => i.label === 'Warranty & AMC')!;
    expect(item.permission).toBe('warranty.view');
    expect(item.roles).toBeUndefined();
  });

  it('shown to roles with warranty.view (OWNER/MANAGER/SALES/TECHNICIAN), hidden for ACCOUNTANT', () => {
    for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN'] as const) {
      expect(labels(role, canFor(role))).toContain('Warranty & AMC');
    }
    expect(labels('ACCOUNTANT', canFor('ACCOUNTANT'))).not.toContain('Warranty & AMC');
  });

  it('a custom role with warranty.view sees it; without it does not (independent of enum)', () => {
    expect(labels('ACCOUNTANT', (p) => p === 'warranty.view')).toContain('Warranty & AMC');
    expect(labels('TECHNICIAN', () => false)).not.toContain('Warranty & AMC');
  });
});
