import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS, type Role } from '@azad/shared';
import { visibleNavItems } from '@/components/layout/nav-items';

// A realistic effective-permission check for a system role (mirrors /auth/me for that role).
const canFor = (role: Role) => (permission: string): boolean => SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
const labelsFor = (role: Role): string[] => visibleNavItems(role, canFor(role)).map((i) => i.label);

// Confirmed business decision: SALES_EXECUTIVE gets read-only Service access (backend already allows
// GET /service/jobs for O|M|S|T). The nav must surface Service for SALES — but NOT Spare Parts
// (backend O|M|T) or any finance/admin area. (Service nav is still role-gated — a later batch.)
describe('Service navigation visibility', () => {
  it('shows Service to SALES_EXECUTIVE', () => {
    expect(labelsFor('SALES_EXECUTIVE')).toContain('Service');
  });

  it('still shows Service to OWNER, MANAGER and TECHNICIAN', () => {
    for (const role of ['OWNER', 'MANAGER', 'TECHNICIAN'] as const) {
      expect(labelsFor(role)).toContain('Service');
    }
  });

  it('does NOT grant SALES_EXECUTIVE Spare Parts, Finance, Reports, Dashboard or Staff nav', () => {
    const labels = labelsFor('SALES_EXECUTIVE');
    for (const hidden of ['Spare Parts', 'Finance', 'Reports', 'Dashboard', 'Staff']) {
      expect(labels).not.toContain(hidden);
    }
  });

  it('does not show Service to ACCOUNTANT (unchanged)', () => {
    expect(labelsFor('ACCOUNTANT')).not.toContain('Service');
  });
});
