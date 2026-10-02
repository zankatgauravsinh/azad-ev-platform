import { describe, it, expect } from 'vitest';
import { visibleNavItems } from '@/components/layout/nav-items';

// Staff Management navigation is OWNER-only. (Server authorization remains the real gate — this is UX only.)
describe('Staff navigation visibility', () => {
  it('shows the Staff entry to an OWNER', () => {
    const labels = visibleNavItems('OWNER').map((i) => i.label);
    expect(labels).toContain('Staff');
  });

  it('hides the Staff entry from non-OWNER roles', () => {
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      const labels = visibleNavItems(role).map((i) => i.label);
      expect(labels).not.toContain('Staff');
    }
  });

  it('points the Staff entry at /staff and marks it enabled', () => {
    const item = visibleNavItems('OWNER').find((i) => i.label === 'Staff');
    expect(item?.to).toBe('/staff');
    expect(item?.enabled).toBe(true);
  });
});
