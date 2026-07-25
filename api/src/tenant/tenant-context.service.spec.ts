import { TenantContext } from './tenant-context.service';

describe('TenantContext', () => {
  const tenant = new TenantContext();

  it('returns null with no active store', () => {
    expect(tenant.getCompanyId()).toBeNull();
  });

  it('exposes the bound companyId inside runWith, including across async', async () => {
    await tenant.runWith('company-1', async () => {
      expect(tenant.getCompanyId()).toBe('company-1');
      await Promise.resolve();
      expect(tenant.getCompanyId()).toBe('company-1'); // preserved across await
    });
    expect(tenant.getCompanyId()).toBeNull(); // cleared outside the scope
  });

  it('isolates concurrent contexts', async () => {
    const results = await Promise.all([
      tenant.runWith('a', async () => { await Promise.resolve(); return tenant.getCompanyId(); }),
      tenant.runWith('b', async () => { await Promise.resolve(); return tenant.getCompanyId(); }),
    ]);
    expect(results).toEqual(['a', 'b']);
  });

  it('requireCompanyId throws when unset', () => {
    expect(() => tenant.requireCompanyId()).toThrow('No tenant in context');
  });
});
