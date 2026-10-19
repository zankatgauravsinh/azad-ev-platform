import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { visibleNavItems } from './nav-items';

/** Purchase orders carry prices (purchase cost): the item needs vendors.view AND inventory.cost. */
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const shows = (role: Role, can: (p: string) => boolean = canFor(role)): boolean => visibleNavItems(role, can).some((i) => i.label === 'Purchase Orders');

describe('nav — Purchase Orders', () => {
  it('the owner sees it; manager and accountant (no purchase cost) do not', () => {
    expect(shows('OWNER')).toBe(true);
    expect(shows('MANAGER')).toBe(false);
    expect(shows('ACCOUNTANT')).toBe(false);
    expect(shows('SALES_EXECUTIVE')).toBe(false);
  });
  it('a role granted inventory.cost besides vendors.view sees it', () => {
    expect(shows('ACCOUNTANT', (p) => canFor('ACCOUNTANT')(p) || p === 'inventory.cost')).toBe(true);
  });
});
