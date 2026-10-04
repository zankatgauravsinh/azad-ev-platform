import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/**
 * Batch 2 RBAC nav migration — Customers / Inventory / Quotations / Bookings / Delivery are gated by
 * *.view permissions via can(), not by legacy role arrays. Visibility must follow permissions,
 * including for custom roles whose legacy enum would say otherwise.
 */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);

const BATCH2 = [
  { label: 'Customers', permission: 'customers.view' },
  { label: 'Inventory', permission: 'inventory.view' },
  { label: 'Quotations', permission: 'quotations.view' },
  { label: 'Bookings', permission: 'bookings.view' },
  { label: 'Delivery', permission: 'delivery.view' },
] as const;

describe('Batch 2 nav items are permission-gated', () => {
  it('each migrated item carries its *.view permission and no legacy roles list', () => {
    for (const { label, permission } of BATCH2) {
      const item = NAV_ITEMS.find((i) => i.label === label)!;
      expect(item.permission).toBe(permission);
      expect(item.roles).toBeUndefined();
    }
  });

  it('OWNER, MANAGER and SALES see all five (they hold every *.view)', () => {
    for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE'] as const) {
      const l = labels(role, canFor(role));
      for (const { label } of BATCH2) expect(l).toContain(label);
    }
  });

  it('TECHNICIAN and ACCOUNTANT see none of the five (they hold no *.view)', () => {
    for (const role of ['TECHNICIAN', 'ACCOUNTANT'] as const) {
      const l = labels(role, canFor(role));
      for (const { label } of BATCH2) expect(l).not.toContain(label);
    }
  });

  it('a custom role with only customers.view shows Customers but no other Batch 2 nav', () => {
    const can = (p: string): boolean => p === 'customers.view';
    const l = labels('TECHNICIAN', can); // legacy enum would show none of these
    expect(l).toContain('Customers');
    for (const { label } of BATCH2.filter((b) => b.label !== 'Customers')) expect(l).not.toContain(label);
  });

  it('a custom role with inventory.view (+export) shows Inventory, not the others', () => {
    const can = (p: string): boolean => p === 'inventory.view' || p === 'inventory.export';
    const l = labels('ACCOUNTANT', can);
    expect(l).toContain('Inventory');
    for (const { label } of BATCH2.filter((b) => b.label !== 'Inventory')) expect(l).not.toContain(label);
  });

  it('a zero-permission user sees none of the Batch 2 nav items', () => {
    const l = labels('SALES_EXECUTIVE', () => false);
    for (const { label } of BATCH2) expect(l).not.toContain(label);
  });
});
