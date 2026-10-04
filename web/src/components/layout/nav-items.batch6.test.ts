import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/** Batch 6 nav — Returns gates on returns.view. */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

describe('Batch 6 nav — Returns', () => {
  it('carries permission returns.view and no legacy roles list', () => {
    const item = NAV_ITEMS.find((i) => i.label === 'Returns')!;
    expect(item.permission).toBe('returns.view');
    expect(item.roles).toBeUndefined();
  });

  it('shown to returns.view holders (OWNER/MANAGER/SALES), hidden for TECHNICIAN/ACCOUNTANT', () => {
    for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] as const) {
      expect(labels(role, canFor(role))).toContain('Returns');
    }
    for (const role of ['TECHNICIAN', 'ACCOUNTANT'] as const) {
      expect(labels(role, canFor(role))).not.toContain('Returns');
    }
  });

  it('a custom role with returns.view sees it; a zero-permission role does not', () => {
    expect(labels('TECHNICIAN', (p) => p === 'returns.view')).toContain('Returns');
    expect(labels('OWNER', () => false)).not.toContain('Returns');
  });
});
