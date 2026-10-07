import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/** M3 nav — Inventory → Models gates on inventory.view, like Inventory itself. */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

describe('M3 nav — Models', () => {
  it('sits right after Inventory, routes to /inventory/models and carries permission inventory.view (no legacy roles)', () => {
    const idx = NAV_ITEMS.findIndex((i) => i.label === 'Models');
    expect(idx).toBeGreaterThan(0);
    expect(NAV_ITEMS[idx - 1]!.label).toBe('Inventory');
    expect(NAV_ITEMS[idx]).toMatchObject({ to: '/inventory/models', enabled: true, permission: 'inventory.view' });
    expect(NAV_ITEMS[idx]!.roles).toBeUndefined();
  });

  it('1. visible with inventory.view (custom role), 2. hidden without it', () => {
    expect(labels('ACCOUNTANT', (p) => p === 'inventory.view')).toContain('Models');
    expect(labels('OWNER', () => false)).not.toContain('Models');
    expect(labels('OWNER', (p) => p === 'settings.view')).not.toContain('Models');
  });

  it('follows the system roles that already see Inventory', () => {
    for (const role of Object.keys(SYSTEM_ROLE_PERMISSIONS) as Role[]) {
      const items = labels(role, canFor(role));
      expect(items.includes('Models')).toBe(items.includes('Inventory'));
    }
  });
});
