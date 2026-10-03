import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems, type NavItem } from './nav-items';

/**
 * Batch 1 RBAC nav migration. Dashboard / Reports / Settings are now gated by effective permissions
 * (dashboard.view / reports.view / settings.view) via `can()`, not by the legacy `roles` list.
 * These checks lock that behavior and prove visibility follows permissions — including for a custom
 * role whose legacy enum would say otherwise — while not-yet-migrated items stay role-gated.
 */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

const PERMISSION_GATED = ['Dashboard', 'Reports', 'Settings'] as const;

describe('Batch 1 nav items are permission-gated', () => {
  it('the three migrated items carry a permission and no legacy roles list', () => {
    const item = (label: string): NavItem => NAV_ITEMS.find((i) => i.label === label)!;
    expect(item('Dashboard').permission).toBe('dashboard.view');
    expect(item('Reports').permission).toBe('reports.view');
    expect(item('Settings').permission).toBe('settings.view');
    for (const l of PERMISSION_GATED) expect(item(l).roles).toBeUndefined();
  });

  it('OWNER sees all three (OWNER resolves every permission)', () => {
    const l = labels('OWNER', canFor('OWNER'));
    for (const item of PERMISSION_GATED) expect(l).toContain(item);
  });

  it('MANAGER sees all three (dashboard.view / reports.view / settings.view)', () => {
    const l = labels('MANAGER', canFor('MANAGER'));
    for (const item of PERMISSION_GATED) expect(l).toContain(item);
  });

  it('SALES / TECHNICIAN / ACCOUNTANT see none of the three (they lack those permissions)', () => {
    for (const role of ['SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      const l = labels(role, canFor(role));
      for (const item of PERMISSION_GATED) expect(l).not.toContain(item);
    }
  });

  it('a custom role drives visibility by permission, not by its legacy enum', () => {
    // Legacy enum TECHNICIAN would never have shown Dashboard — but the custom role grants dashboard.view.
    const customCan = (p: string): boolean => p === 'dashboard.view';
    const l = labels('TECHNICIAN', customCan);
    expect(l).toContain('Dashboard'); // permission-driven, overrides the enum
    expect(l).not.toContain('Reports'); // not granted
    expect(l).not.toContain('Settings'); // not granted
  });

  it('a user with zero permissions sees no permission-gated nav item', () => {
    const l = labels('TECHNICIAN', () => false);
    for (const item of PERMISSION_GATED) expect(l).not.toContain(item);
    expect(l).toContain('Home'); // ungated item still visible
  });

  it('OWNER still sees the OWNER-only Staff item (legacy role-gated, later batch)', () => {
    expect(labels('OWNER', canFor('OWNER'))).toContain('Staff');
    expect(labels('MANAGER', canFor('MANAGER'))).not.toContain('Staff');
  });
});
