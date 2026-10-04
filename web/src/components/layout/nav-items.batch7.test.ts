import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { NAV_ITEMS, visibleNavItems } from './nav-items';

/**
 * Batch 7 nav — Finance is a shared page aggregating five independent permission families. Per the
 * reviewed Option 2 decision, the nav item is shown when the user has ANY finance-family *.view;
 * each tab inside the page is still gated by its own permission. finance.view is NOT a parent
 * permission and grants nothing.
 */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labels = (role: Role, can: (p: string) => boolean): string[] => visibleNavItems(role, can).map((i) => i.label);
const has = (can: (p: string) => boolean): boolean => labels('ACCOUNTANT', can).includes('Finance');
const only = (perm: string) => (p: string): boolean => p === perm;

describe('Batch 7 nav — Finance (Option 2: any finance-family view)', () => {
  it('uses anyPermission (union of the five finance-family views), not a single permission/roles', () => {
    const item = NAV_ITEMS.find((i) => i.label === 'Finance')!;
    expect(item.anyPermission).toEqual(['finance.view', 'expenses.view', 'income.view', 'vendors.view', 'bank.view']);
    expect(item.permission).toBeUndefined();
    expect(item.roles).toBeUndefined();
  });

  it('finance.view alone → Finance visible', () => {
    expect(has(only('finance.view'))).toBe(true);
  });
  it('expenses.view alone → Finance visible', () => {
    expect(has(only('expenses.view'))).toBe(true);
  });
  it('income.view alone → Finance visible', () => {
    expect(has(only('income.view'))).toBe(true);
  });
  it('vendors.view alone → Finance visible', () => {
    expect(has(only('vendors.view'))).toBe(true);
  });
  it('bank.view alone → Finance visible', () => {
    expect(has(only('bank.view'))).toBe(true);
  });

  it('none of the five finance-family views → Finance hidden', () => {
    expect(has(() => false)).toBe(false);
  });
  it('an unrelated permission only → Finance hidden', () => {
    expect(has(only('service.view'))).toBe(false);
  });

  it('system roles: OWNER/MANAGER/ACCOUNTANT see Finance; SALES/TECHNICIAN do not', () => {
    for (const role of ['OWNER', 'MANAGER', 'ACCOUNTANT'] as const) {
      expect(labels(role, canFor(role))).toContain('Finance');
    }
    for (const role of ['SALES_EXECUTIVE', 'TECHNICIAN'] as const) {
      expect(labels(role, canFor(role))).not.toContain('Finance');
    }
  });
});
