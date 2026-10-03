import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/** Batch 5 nav — Service gates on service.view. */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

describe('Batch 5 nav — Service', () => {
  it('carries permission service.view and no legacy roles list', () => {
    const item = NAV_ITEMS.find((i) => i.label === 'Service')!;
    expect(item.permission).toBe('service.view');
    expect(item.roles).toBeUndefined();
  });

  it('shown to service.view holders (OWNER/MANAGER/SALES/TECHNICIAN), hidden for ACCOUNTANT', () => {
    for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN'] as const) {
      expect(labels(role, canFor(role))).toContain('Service');
    }
    expect(labels('ACCOUNTANT', canFor('ACCOUNTANT'))).not.toContain('Service');
  });

  it('a custom role with service.view sees it; a zero-permission role does not', () => {
    expect(labels('ACCOUNTANT', (p) => p === 'service.view')).toContain('Service');
    expect(labels('OWNER', () => false)).not.toContain('Service');
  });
});
