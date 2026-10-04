import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/**
 * Batch 4 nav — Spare Parts gates on spareparts.view. (Service Reports has no nav item; it is
 * reached from the Service page and gated by reports.view there. Labour has no nav/page.)
 */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

describe('Batch 4 nav — Spare Parts', () => {
  it('carries permission spareparts.view and no legacy roles list', () => {
    const item = NAV_ITEMS.find((i) => i.label === 'Spare Parts')!;
    expect(item.permission).toBe('spareparts.view');
    expect(item.roles).toBeUndefined();
  });

  it('shown to spareparts.view holders (OWNER/MANAGER/TECHNICIAN), hidden for SALES/ACCOUNTANT', () => {
    for (const role of ['OWNER', 'MANAGER', 'TECHNICIAN'] as const) {
      expect(labels(role, canFor(role))).toContain('Spare Parts');
    }
    for (const role of ['SALES_EXECUTIVE', 'ACCOUNTANT'] as const) {
      expect(labels(role, canFor(role))).not.toContain('Spare Parts');
    }
  });

  it('a custom role with spareparts.view sees it; a zero-permission role does not', () => {
    expect(labels('ACCOUNTANT', (p) => p === 'spareparts.view')).toContain('Spare Parts');
    expect(labels('TECHNICIAN', () => false)).not.toContain('Spare Parts');
  });
});
