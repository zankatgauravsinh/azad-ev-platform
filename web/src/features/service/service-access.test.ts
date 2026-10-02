import { describe, it, expect } from 'vitest';
import { visibleNavItems } from '@/components/layout/nav-items';

// Confirmed business decision: SALES_EXECUTIVE gets read-only Service access (backend already allows
// GET /service/jobs for O|M|S|T). The nav must surface Service for SALES — but NOT Spare Parts
// (backend O|M|T) or any finance/admin area.
describe('Service navigation visibility', () => {
  it('shows Service to SALES_EXECUTIVE', () => {
    const labels = visibleNavItems('SALES_EXECUTIVE').map((i) => i.label);
    expect(labels).toContain('Service');
  });

  it('still shows Service to OWNER, MANAGER and TECHNICIAN', () => {
    for (const role of ['OWNER', 'MANAGER', 'TECHNICIAN'] as const) {
      expect(visibleNavItems(role).map((i) => i.label)).toContain('Service');
    }
  });

  it('does NOT grant SALES_EXECUTIVE Spare Parts, Finance, Reports, Dashboard or Staff nav', () => {
    const labels = visibleNavItems('SALES_EXECUTIVE').map((i) => i.label);
    for (const hidden of ['Spare Parts', 'Finance', 'Reports', 'Dashboard', 'Staff']) {
      expect(labels).not.toContain(hidden);
    }
  });

  it('does not show Service to ACCOUNTANT (unchanged)', () => {
    expect(visibleNavItems('ACCOUNTANT').map((i) => i.label)).not.toContain('Service');
  });
});
