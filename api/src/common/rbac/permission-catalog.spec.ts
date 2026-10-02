import {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  PERMISSION_MODULES,
  isPermissionKey,
  type PermissionModule,
} from '@azad/shared';

/**
 * Foundation test for the system permission catalog (Group 1). It locks the catalog's shape and
 * the keys that later groups (seed, PermissionsGuard, frontend `can()`) will depend on. It does
 * NOT assert any role→permission mapping — that is Group 2 (seed).
 */
describe('permission catalog', () => {
  it('has unique, well-formed keys (module.action, module in the module list)', () => {
    const modules = new Set<string>(PERMISSION_MODULES);
    for (const p of PERMISSIONS) {
      expect(p.key).toBe(`${p.module}.${p.action}`);
      expect(modules.has(p.module)).toBe(true);
      expect(p.action).toMatch(/^[a-z]+$/);
      expect(p.label.length).toBeGreaterThan(0);
    }
    expect(PERMISSION_KEY_SET.size).toBe(PERMISSIONS.length); // no duplicate keys
    expect(PERMISSION_KEYS.length).toBe(PERMISSIONS.length);
  });

  it('matches the approved catalog size (regression lock)', () => {
    expect(PERMISSIONS.length).toBe(73);
    expect(PERMISSION_MODULES.length).toBe(25);
  });

  it('every module declares at least one permission', () => {
    for (const module of PERMISSION_MODULES) {
      expect(PERMISSIONS.some((p) => p.module === module)).toBe(true);
    }
  });

  it('contains the specific keys later groups rely on', () => {
    const required = [
      'customers.view', 'customers.delete',
      'inventory.view', 'inventory.status', 'inventory.dashboard', 'inventory.export',
      'quotations.delete', // SALES can delete quotations (preserved)
      'bookings.payment', 'bookings.cancel', 'bookings.invoice',
      'delivery.manage',
      'returns.approve', 'returns.complete',
      'service.view', 'service.workflow', 'service.bill', 'service.payment',
      'spareparts.adjust', 'labour.manage',
      'warranty.cancel', 'amc.manage', 'claims.manage',
      'finance.manage', 'expenses.manage', 'bank.manage', 'income.manage', 'vendors.manage',
      'reports.view', 'dashboard.view',
      'search.use', 'notifications.use',
      'accessories.manage',
      'settings.manage', 'settings.branding',
      'staff.manage', 'roles.manage',
    ];
    for (const key of required) expect(PERMISSION_KEY_SET.has(key)).toBe(true);
  });

  it('flags sensitive permissions as dangerous and safe reads as not', () => {
    const danger = (key: string): boolean => PERMISSIONS.find((p) => p.key === key)!.isDangerous;
    for (const key of ['customers.delete', 'returns.complete', 'service.payment', 'finance.manage', 'staff.manage', 'roles.manage']) {
      expect(danger(key)).toBe(true);
    }
    for (const key of ['customers.view', 'service.view', 'reports.view', 'settings.branding']) {
      expect(danger(key)).toBe(false);
    }
  });

  it('isPermissionKey only accepts catalog keys', () => {
    expect(isPermissionKey('customers.create')).toBe(true);
    expect(isPermissionKey('customers.destroy')).toBe(false);
    expect(isPermissionKey('totally.bogus')).toBe(false);
  });

  it('exposes modules as a readonly ordered list', () => {
    const first: PermissionModule = PERMISSION_MODULES[0];
    expect(first).toBe('customers');
    expect(PERMISSION_MODULES[PERMISSION_MODULES.length - 1]).toBe('roles');
  });
});
