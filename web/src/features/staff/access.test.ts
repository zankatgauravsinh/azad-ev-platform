import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { visibleNavItems } from '@/components/layout/nav-items';

// Staff Management navigation is OWNER-only (still legacy role-gated — a later batch). Server
// authorization remains the real gate — this is UX only.
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const itemsFor = (role: Role): ReturnType<typeof visibleNavItems> => visibleNavItems(role, canFor(role));

describe('Staff navigation visibility', () => {
  it('shows the Staff entry to an OWNER', () => {
    expect(itemsFor('OWNER').map((i) => i.label)).toContain('Staff');
  });

  it('hides the Staff entry from non-OWNER roles', () => {
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      expect(itemsFor(role).map((i) => i.label)).not.toContain('Staff');
    }
  });

  it('points the Staff entry at /staff and marks it enabled', () => {
    const item = itemsFor('OWNER').find((i) => i.label === 'Staff');
    expect(item?.to).toBe('/staff');
    expect(item?.enabled).toBe(true);
  });
});
