import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Stage C.1 — GST configuration through the application's own APIs: company registration + activation
 * gate, discount / exchange policy, component mappings, scooter-model and accessory classification,
 * customer state code, readiness, RBAC, tenant isolation, audit, and snapshot immutability.
 *
 * Runs in THROWAWAY companies that are hard-deleted afterwards; the seeded company is never read or
 * changed. GSTINs, codes and rates are synthetic PLACEHOLDERS — not real registrations, HSN/SAC values
 * or approved GST rates.
 */
describe('GST configuration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;
  let passwordHash = '';

  // Synthetic, well-formed GSTIN-shaped placeholders.
  const GSTIN_24 = '24AAAAA0000A1Z5';
  const GSTIN_27 = '27CCCCC2222C1Z7';

  interface Co { id: string; owner: string; modelId: string }
  const A = {} as Co;
  const B = {} as Co;
  const tokens: Record<string, string> = {};
  const bearer = (t: string): string => `Bearer ${t}`;

  const login = async (email: string): Promise<string> => (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;

  const setupCompany = async (co: Co, label: string): Promise<void> => {
    co.id = (await prisma.company.create({ data: { name: `TaxCfg ${label} ${stamp}`, slug: `taxcfg-${label}-${stamp}` } })).id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const email = `taxcfg.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash } });
    // Document codes are unique across all companies, so a new company needs its own prefixes.
    await prisma.companySetting.create({ data: { companyId: co.id, bookingPrefix: `C${label}${stamp}-BK`, invoicePrefix: `C${label}${stamp}-INV`, receiptPrefix: `C${label}${stamp}-RC` } });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.owner = await login(email);
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `Cfg Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
  };

  /** A non-owner user of company A holding exactly the given permissions (via a custom role). */
  const makeUser = async (label: string, permissionKeys: string[]): Promise<string> => {
    const role = await prisma.appRole.create({ data: { companyId: A.id, name: `cfg-${label}-${stamp}`, isSystem: false, isProtected: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    expect(perms).toHaveLength(permissionKeys.length);
    if (perms.length > 0) await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const email = `taxcfg.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: A.id, name: `User ${label}`, email, role: 'SALES_EXECUTIVE', roleId: role.id, passwordHash } });
    return login(email);
  };

  const createClass = async (token: string, name: string, over: Record<string, unknown> = {}, ratePercent?: number): Promise<string> => {
    const res = await http().post('/api/v1/tax/classifications').set('Authorization', bearer(token)).send({ name: `${name} ${stamp}`, codeType: 'HSN', code: `TEST-${name.toUpperCase()}`, treatment: 'TAXABLE', ...over }).expect(201);
    if (ratePercent !== undefined) await http().post(`/api/v1/tax/classifications/${res.body.id}/rates`).set('Authorization', bearer(token)).send({ ratePercent, effectiveFrom: '2020-01-01' }).expect(201);
    return res.body.id;
  };
  const patchSettings = (token: string, body: Record<string, unknown>) => http().patch('/api/v1/settings/company').set('Authorization', bearer(token)).send(body);
  const readiness = async (token: string) => (await http().get('/api/v1/tax/readiness').set('Authorization', bearer(token)).expect(200)).body;
  const audit = (entityType: string, startsWith: string) => prisma.activityLog.findFirst({ where: { companyId: A.id, entityType, summary: { startsWith } }, orderBy: { createdAt: 'desc' } });

  const cls: Record<string, string> = {};
  let bClassId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    await seedRbac(prisma); // the permission catalogue the custom roles below link to
    passwordHash = await bcrypt.hash('Test@12345', 10);

    await setupCompany(A, 'a');
    await setupCompany(B, 'b');
    tokens.viewer = await makeUser('viewer', ['settings.view']);
    tokens.none = await makeUser('none', []);
    tokens.gstAdmin = await makeUser('gstadmin', ['settings.view', 'settings.manage']); // no inventory / accessories rights
    tokens.inventory = await makeUser('inventory', ['inventory.view', 'inventory.update']);
    tokens.accessories = await makeUser('accessories', ['accessories.view', 'accessories.manage']);
    tokens.customerViewer = await makeUser('custview', ['customers.view']);

    // Classifications are created through the existing Stage A API.
    cls.vehicle = await createClass(A.owner, 'Vehicle', {}, 5);
    cls.other = await createClass(A.owner, 'Other', {}, 18);
    cls.rto = await createClass(A.owner, 'Rto', { treatment: 'NON_TAXABLE', code: null });
    cls.inactive = await createClass(A.owner, 'Inactive', { isActive: false }, 5);
    cls.archived = await createClass(A.owner, 'Archived', {}, 5);
    await http().delete(`/api/v1/tax/classifications/${cls.archived}`).set('Authorization', bearer(A.owner)).expect(200);
    bClassId = await createClass(B.owner, 'B only', {}, 5);
  }, 60000);

  afterAll(async () => {
    for (const id of [A.id, B.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "TaxSnapshot" WHERE "companyId" = $1',
        'DELETE FROM "Sale" WHERE "companyId" = $1',
        'DELETE FROM "Booking" WHERE "companyId" = $1',
        'DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1',
        'DELETE FROM "Notification" WHERE "companyId" = $1',
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "Customer" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" e USING "InventoryUnit" u WHERE e."unitId" = u.id AND u."companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "Accessory" WHERE "companyId" = $1',
        'DELETE FROM "TaxComponentMapping" WHERE "companyId" = $1',
        'DELETE FROM "TaxClassification" WHERE "companyId" = $1',
        'DELETE FROM "InvoiceSetting" WHERE "companyId" = $1',
        'DELETE FROM "CompanySetting" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "AppRole" WHERE "companyId" = $1',
        'DELETE FROM "Branch" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) {
        await prisma.$executeRawUnsafe(sql, id);
      }
    }
    await app.close();
  });

  // ───────────────────────── Company GST settings + activation gate ─────────────────────────
  describe('company GST registration', () => {
    it('is off by default and exposes the GST fields on the existing settings API', async () => {
      const res = await http().get('/api/v1/settings/company').set('Authorization', bearer(A.owner)).expect(200);
      expect(res.body).toMatchObject({ gstEnabled: false, gstNumber: null, gstStateCode: null, gstDiscountTreatment: null, gstExchangeTreatment: null });
    });

    it('refuses to enable GST with incomplete or malformed registration — backend gate, not UI', async () => {
      await patchSettings(A.owner, { gstEnabled: true, gstNumber: '' }).expect(400); // no GSTIN
      const noState = await patchSettings(A.owner, { gstEnabled: true, gstNumber: GSTIN_24 }).expect(400); // no state code
      expect(noState.body.message).toContain('GST state code is not set');
      const malformed = await patchSettings(A.owner, { gstEnabled: true, gstNumber: 'NOT-A-GSTIN', gstStateCode: '24' }).expect(400);
      expect(malformed.body.message).toContain('well-formed');
      const mismatch = await patchSettings(A.owner, { gstEnabled: true, gstNumber: GSTIN_24, gstStateCode: '27' }).expect(400);
      expect(mismatch.body.message).toContain('does not match');
      await patchSettings(A.owner, { gstStateCode: 'GJ' }).expect(400); // not two digits
      await patchSettings(A.owner, { gstStateCode: '240' }).expect(400);
      expect((await prisma.companySetting.findFirstOrThrow({ where: { companyId: A.id } })).gstEnabled).toBe(false);
    });

    it('stores registration details while GST is off (upper-cased GSTIN; empty clears)', async () => {
      const res = await patchSettings(A.owner, { gstNumber: GSTIN_24.toLowerCase(), gstStateCode: '24' }).expect(200);
      expect(res.body).toMatchObject({ gstEnabled: false, gstNumber: GSTIN_24, gstStateCode: '24' });
      const cleared = await patchSettings(A.owner, { gstNumber: '', gstStateCode: '' }).expect(200);
      expect(cleared.body).toMatchObject({ gstNumber: null, gstStateCode: null });
    });

    it('enables GST once the registration is complete — no component mapping or product classification is required', async () => {
      const before = await readiness(A.owner);
      expect(before).toMatchObject({ gstEnabled: false, canEnable: false });
      expect(before.blockers.length).toBeGreaterThan(0);
      expect(before.componentMappings.every((m: { classification: unknown }) => m.classification === null)).toBe(true);

      const res = await patchSettings(A.owner, { gstEnabled: true, gstNumber: GSTIN_24, gstStateCode: '24' }).expect(200);
      expect(res.body).toMatchObject({ gstEnabled: true, gstNumber: GSTIN_24, gstStateCode: '24' });
      const after = await readiness(A.owner);
      expect(after).toMatchObject({ gstEnabled: true, canEnable: true, blockers: [] });
      expect(after.registration).toEqual({ gstinPresent: true, gstinWellFormed: true, stateCodePresent: true, stateCodeValid: true, stateCodeMatchesGstin: true });
    });

    it('audits GST setting changes with old and new values', async () => {
      const entry = await audit('CompanySetting', 'GST settings changed');
      expect(entry).not.toBeNull();
      expect(entry!.summary).toContain('gstEnabled false → true');
      expect(entry!.metadata).toMatchObject({ gstChanges: { gstEnabled: { from: false, to: true } } });
    });

    it('while enabled, the registration cannot be broken; unrelated settings still save; disabling is always allowed', async () => {
      await patchSettings(A.owner, { gstStateCode: '' }).expect(400); // would leave GST on with no state code
      await patchSettings(A.owner, { gstNumber: '' }).expect(400);
      await patchSettings(A.owner, { tagline: `Tagline ${stamp}` }).expect(200); // does not touch registration
      const off = await patchSettings(A.owner, { gstEnabled: false }).expect(200);
      expect(off.body.gstEnabled).toBe(false);
      await patchSettings(A.owner, { gstEnabled: true, gstNumber: GSTIN_24, gstStateCode: '24' }).expect(200);
    });

    it('records discount / exchange policy with no default, and allows clearing back to "not configured"', async () => {
      expect((await readiness(A.owner))).toMatchObject({ discountTreatment: null, exchangeTreatment: null });
      const set = await patchSettings(A.owner, { gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }).expect(200);
      expect(set.body).toMatchObject({ gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' });
      await patchSettings(A.owner, { gstDiscountTreatment: 'SOMETHING_ELSE' }).expect(400);
      const cleared = await patchSettings(A.owner, { gstDiscountTreatment: null, gstExchangeTreatment: null }).expect(200);
      expect(cleared.body).toMatchObject({ gstDiscountTreatment: null, gstExchangeTreatment: null });
      expect((await audit('CompanySetting', 'GST settings changed'))!.summary).toContain('gstDiscountTreatment');
    });

    it('RBAC: settings.view reads, only settings.manage writes', async () => {
      await http().get('/api/v1/settings/company').set('Authorization', bearer(tokens.viewer!)).expect(200);
      await http().get('/api/v1/tax/readiness').set('Authorization', bearer(tokens.viewer!)).expect(200);
      await patchSettings(tokens.viewer!, { gstEnabled: false }).expect(403);
      await http().get('/api/v1/settings/company').set('Authorization', bearer(tokens.none!)).expect(403);
      await http().get('/api/v1/tax/readiness').set('Authorization', bearer(tokens.none!)).expect(403);
      await http().get('/api/v1/tax/component-mappings').set('Authorization', bearer(tokens.none!)).expect(403);
    });

    it('tenant isolation: company B is untouched and still has GST off', async () => {
      const b = await http().get('/api/v1/settings/company').set('Authorization', bearer(B.owner)).expect(200);
      expect(b.body).toMatchObject({ gstEnabled: false, gstNumber: null, gstStateCode: null });
      expect(await readiness(B.owner)).toMatchObject({ gstEnabled: false, canEnable: false });
    });
  });

  // ───────────────────────── Component mappings ─────────────────────────
  describe('component mappings', () => {
    const put = (token: string, component: string, classificationId: string) =>
      http().put(`/api/v1/tax/component-mappings/${component}`).set('Authorization', bearer(token)).send({ classificationId });

    it('lists all four components, unmapped by default', async () => {
      const res = await http().get('/api/v1/tax/component-mappings').set('Authorization', bearer(A.owner)).expect(200);
      expect(res.body).toEqual([
        { component: 'EXTENDED_WARRANTY', classification: null, usable: false },
        { component: 'RTO', classification: null, usable: false },
        { component: 'INSURANCE', classification: null, usable: false },
        { component: 'REGISTRATION', classification: null, usable: false },
      ]);
    });

    it('assigns, then replaces in place (never a second row), then clears', async () => {
      const created = await put(A.owner, 'RTO', cls.rto!).expect(200);
      expect(created.body).toMatchObject({ component: 'RTO', usable: true, classification: { id: cls.rto, treatment: 'NON_TAXABLE', code: null } });
      const replaced = await put(A.owner, 'RTO', cls.other!).expect(200);
      expect(replaced.body.classification.id).toBe(cls.other);
      expect(await prisma.taxComponentMapping.count({ where: { companyId: A.id, componentType: 'RTO' } })).toBe(1);
      // The database itself refuses a duplicate component for a company.
      await expect(prisma.taxComponentMapping.create({ data: { companyId: A.id, componentType: 'RTO', classificationId: cls.rto! } })).rejects.toThrow();

      const cleared = await http().delete('/api/v1/tax/component-mappings/RTO').set('Authorization', bearer(A.owner)).expect(200);
      expect(cleared.body).toEqual({ component: 'RTO', classification: null, usable: false });
      expect(await prisma.taxComponentMapping.count({ where: { companyId: A.id } })).toBe(0);
      await http().delete('/api/v1/tax/component-mappings/RTO').set('Authorization', bearer(A.owner)).expect(200); // idempotent
    });

    it('rejects an unknown component, and another tenant’s, an inactive or an archived classification', async () => {
      await put(A.owner, 'VEHICLE', cls.rto!).expect(400); // not a mappable component
      await put(A.owner, 'RTO', bClassId).expect(400); // company B's
      await put(A.owner, 'RTO', cls.inactive!).expect(400);
      await put(A.owner, 'RTO', cls.archived!).expect(400);
      await put(A.owner, 'RTO', 'not-a-uuid').expect(400);
      expect(await prisma.taxComponentMapping.count({ where: { companyId: A.id } })).toBe(0);
    });

    it('RBAC: settings.manage is required to change a mapping', async () => {
      await put(tokens.viewer!, 'RTO', cls.rto!).expect(403);
      await http().delete('/api/v1/tax/component-mappings/RTO').set('Authorization', bearer(tokens.viewer!)).expect(403);
      await put(tokens.inventory!, 'RTO', cls.rto!).expect(403);
      await put(tokens.gstAdmin!, 'RTO', cls.rto!).expect(200);
    });

    it('audits mapping changes with old and new classification ids', async () => {
      await put(A.owner, 'RTO', cls.other!).expect(200);
      const entry = await audit('TaxComponentMapping', 'GST mapping for RTO set');
      expect(entry!.metadata).toMatchObject({ component: 'RTO', fromClassificationId: cls.rto, toClassificationId: cls.other });
      await put(A.owner, 'RTO', cls.rto!).expect(200);
    });

    it('a mapping is company-scoped: company B sees none of A’s, and readiness reports mapped components', async () => {
      const b = await http().get('/api/v1/tax/component-mappings').set('Authorization', bearer(B.owner)).expect(200);
      expect(b.body.every((m: { classification: unknown }) => m.classification === null)).toBe(true);
      const r = await readiness(A.owner);
      expect(r.componentMappings.find((m: { component: string }) => m.component === 'RTO')).toMatchObject({ usable: true, classification: { id: cls.rto } });
      // Unmapped, unused components are reported, not treated as errors.
      expect(r.canEnable).toBe(true);
    });
  });

  // ───────────────────────── Product classification ─────────────────────────
  describe('scooter model and accessory classification', () => {
    let accessoryId = '';
    let bAccessoryId = '';
    const putModel = (token: string, modelId: string, taxClassificationId: string | null) =>
      http().put(`/api/v1/tax/scooter-models/${modelId}/classification`).set('Authorization', bearer(token)).send({ taxClassificationId });
    const putAccessory = (token: string, id: string, taxClassificationId: string | null) =>
      http().put(`/api/v1/tax/accessories/${id}/classification`).set('Authorization', bearer(token)).send({ taxClassificationId });

    beforeAll(async () => {
      accessoryId = (await http().post('/api/v1/accessories').set('Authorization', bearer(A.owner)).send({ name: `Cfg Acc ${stamp}`, sellPrice: 59000 }).expect(201)).body.id;
      bAccessoryId = (await http().post('/api/v1/accessories').set('Authorization', bearer(B.owner)).send({ name: `Cfg Acc B ${stamp}`, sellPrice: 59000 }).expect(201)).body.id;
    });

    it('models and accessories start unclassified — nothing is assigned automatically', async () => {
      const models = await http().get('/api/v1/inventory/models').set('Authorization', bearer(A.owner)).expect(200);
      expect(models.body.find((m: { id: string }) => m.id === A.modelId).taxClassificationId).toBeNull();
      const accessories = await http().get('/api/v1/accessories').set('Authorization', bearer(A.owner)).expect(200);
      expect(accessories.body.find((a: { id: string }) => a.id === accessoryId).taxClassificationId).toBeNull();
      expect(await readiness(A.owner)).toMatchObject({ scooterModels: { total: 1, classified: 0, missing: 1 }, accessories: { total: 1, classified: 0, missing: 1 } });
    });

    it('assigns and clears a scooter model’s classification (inventory.update), visible on the existing model list', async () => {
      expect((await putModel(tokens.inventory!, A.modelId, cls.vehicle!).expect(200)).body).toEqual({ id: A.modelId, taxClassificationId: cls.vehicle });
      const models = await http().get('/api/v1/inventory/models').set('Authorization', bearer(A.owner)).expect(200);
      expect(models.body.find((m: { id: string }) => m.id === A.modelId).taxClassificationId).toBe(cls.vehicle);
      expect((await putModel(A.owner, A.modelId, null).expect(200)).body.taxClassificationId).toBeNull();
      await putModel(A.owner, A.modelId, cls.vehicle!).expect(200);
      expect((await audit('ScooterModel', 'GST classification of model'))!.metadata).toMatchObject({ fromClassificationId: null, toClassificationId: cls.vehicle });
    });

    it('assigns and clears an accessory’s classification (accessories.manage)', async () => {
      expect((await putAccessory(tokens.accessories!, accessoryId, cls.other!).expect(200)).body).toEqual({ id: accessoryId, taxClassificationId: cls.other });
      expect((await putAccessory(A.owner, accessoryId, null).expect(200)).body.taxClassificationId).toBeNull();
      await putAccessory(A.owner, accessoryId, cls.other!).expect(200);
      expect((await audit('Accessory', 'GST classification of accessory'))!.metadata).toMatchObject({ toClassificationId: cls.other });
      expect(await readiness(A.owner)).toMatchObject({ scooterModels: { total: 1, classified: 1, missing: 0 }, accessories: { total: 1, classified: 1, missing: 0 } });
    });

    it('rejects another tenant’s, an inactive or an archived classification', async () => {
      for (const bad of [bClassId, cls.inactive!, cls.archived!]) {
        await putModel(A.owner, A.modelId, bad).expect(400);
        await putAccessory(A.owner, accessoryId, bad).expect(400);
      }
      expect((await prisma.scooterModel.findFirstOrThrow({ where: { id: A.modelId } })).taxClassificationId).toBe(cls.vehicle);
      expect((await prisma.accessory.findFirstOrThrow({ where: { id: accessoryId } })).taxClassificationId).toBe(cls.other);
    });

    it('tenant isolation: another company’s model or accessory cannot be reached', async () => {
      await putModel(A.owner, B.modelId, cls.vehicle!).expect(404);
      await putAccessory(A.owner, bAccessoryId, cls.other!).expect(404);
      expect((await prisma.scooterModel.findFirstOrThrow({ where: { id: B.modelId } })).taxClassificationId).toBeNull();
      expect((await prisma.accessory.findFirstOrThrow({ where: { id: bAccessoryId } })).taxClassificationId).toBeNull();
    });

    it('RBAC: the product’s own permission is required — holding settings.manage is not enough', async () => {
      await putModel(tokens.gstAdmin!, A.modelId, cls.vehicle!).expect(403);
      await putAccessory(tokens.gstAdmin!, accessoryId, cls.other!).expect(403);
      await putModel(tokens.accessories!, A.modelId, cls.vehicle!).expect(403);
      await putAccessory(tokens.inventory!, accessoryId, cls.other!).expect(403);
      await putModel(tokens.viewer!, A.modelId, null).expect(403);
    });
  });

  // ───────────────────────── Customer GST state code ─────────────────────────
  describe('customer GST state code', () => {
    let customerId = '';
    let bCustomerId = '';
    const patch = (token: string, id: string, body: Record<string, unknown>) => http().patch(`/api/v1/customers/${id}`).set('Authorization', bearer(token)).send(body);

    it('is optional on create and never inferred from the free-text state', async () => {
      const plain = await http().post('/api/v1/customers').set('Authorization', bearer(A.owner)).send({ name: 'Cfg Plain', phone: `9${stamp}${serial++}`, state: 'Gujarat', pin: '362560' }).expect(201);
      expect(plain.body.gstStateCode).toBeNull();
      const withCode = await http().post('/api/v1/customers').set('Authorization', bearer(A.owner)).send({ name: 'Cfg Coded', phone: `9${stamp}${serial++}`, state: 'Gujarat', gstStateCode: '24' }).expect(201);
      expect(withCode.body.gstStateCode).toBe('24');
      customerId = withCode.body.id;
      bCustomerId = (await http().post('/api/v1/customers').set('Authorization', bearer(B.owner)).send({ name: 'Cfg B', phone: `9${stamp}${serial++}` }).expect(201)).body.id;
    });

    it('updates, validates and clears the code', async () => {
      expect((await patch(A.owner, customerId, { gstStateCode: '27' }).expect(200)).body.gstStateCode).toBe('27');
      await patch(A.owner, customerId, { gstStateCode: 'GJ' }).expect(400);
      await patch(A.owner, customerId, { gstStateCode: '240' }).expect(400);
      await patch(A.owner, customerId, { gstStateCode: '2' }).expect(400);
      expect((await patch(A.owner, customerId, { gstStateCode: '' }).expect(200)).body.gstStateCode).toBeNull();
      // Changing the free-text state does not touch the code, and vice versa.
      expect((await patch(A.owner, customerId, { state: 'Maharashtra' }).expect(200)).body.gstStateCode).toBeNull();
      const set = await patch(A.owner, customerId, { gstStateCode: '24' }).expect(200);
      expect(set.body).toMatchObject({ gstStateCode: '24', state: 'Maharashtra' });
    });

    it('RBAC and tenant isolation: customers.update is required, and another company’s customer is not found', async () => {
      await patch(tokens.customerViewer!, customerId, { gstStateCode: '27' }).expect(403);
      await patch(tokens.gstAdmin!, customerId, { gstStateCode: '27' }).expect(403);
      await patch(A.owner, bCustomerId, { gstStateCode: '24' }).expect(404);
      expect((await prisma.customer.findFirstOrThrow({ where: { id: bCustomerId } })).gstStateCode).toBeNull();
      expect((await prisma.customer.findFirstOrThrow({ where: { id: customerId } })).gstStateCode).toBe('24');
    });
  });

  // ───────────────────────── Configured through the app → sale → immutability ─────────────────────────
  describe('configuration changes never alter an existing snapshot', () => {
    it('a sale invoiced with app-configured GST keeps its snapshot after every setting is changed', async () => {
      // Everything this sale needs was configured above through the application's own APIs.
      const customer = await http().post('/api/v1/customers').set('Authorization', bearer(A.owner)).send({ name: 'Cfg Buyer', phone: `9${stamp}${serial++}`, gstStateCode: '24' }).expect(201);
      const accessories = await http().get('/api/v1/accessories').set('Authorization', bearer(A.owner)).expect(200);
      const accessory = accessories.body.find((a: { name: string }) => a.name === `Cfg Acc ${stamp}`);
      const unit = await http().post('/api/v1/inventory/units').set('Authorization', bearer(A.owner)).send({ modelId: A.modelId, variant: `V-${stamp}`, colour: 'Red', vin: `CFGV${stamp}`, motorNumber: `CFGM${stamp}`, batteryNumber: `CFGB${stamp}` }).expect(201);
      const booking = await http()
        .post('/api/v1/bookings')
        .set('Authorization', bearer(A.owner))
        .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 1_000_000, rto: 85_000, accessories: [{ accessoryId: accessory.id, qty: 1, unitPrice: 118_000 }] })
        .expect(201);
      expect(booking.body.total).toBe('1203000');
      await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', bearer(A.owner)).expect(201);

      const sale = await prisma.sale.findFirstOrThrow({ where: { bookingId: booking.body.id } });
      const freeze = async (): Promise<string> =>
        JSON.stringify(await prisma.taxSnapshot.findFirst({ where: { saleId: sale.id }, include: { lines: { orderBy: { position: 'asc' } } } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const before = await freeze();
      const snap = JSON.parse(before);
      expect(snap).toMatchObject({ supplyType: 'INTRA', supplierGstin: GSTIN_24, supplierStateCode: '24', placeOfSupplyStateCode: '24', documentTotal: '1203000', totalGross: '1203000' });
      expect(snap.lines.map((l: { componentType: string; treatment: string }) => [l.componentType, l.treatment])).toEqual([['VEHICLE', 'TAXABLE'], ['ACCESSORY', 'TAXABLE'], ['RTO', 'NON_TAXABLE']]);
      expect(sale.total).toBe(1_203_000n);

      // Now change every piece of configuration — through the same APIs an administrator would use.
      const o = bearer(A.owner);
      await http().patch(`/api/v1/tax/classifications/${cls.vehicle}`).set('Authorization', o).send({ name: `Vehicle renamed ${stamp}`, code: 'CHANGED' }).expect(200);
      const vehicle = await http().get(`/api/v1/tax/classifications/${cls.vehicle}`).set('Authorization', o).expect(200);
      await http().patch(`/api/v1/tax/rates/${vehicle.body.rates[0].id}`).set('Authorization', o).send({ ratePercent: 28 }).expect(200);
      await http().put('/api/v1/tax/component-mappings/RTO').set('Authorization', o).send({ classificationId: cls.other }).expect(200);
      await http().put(`/api/v1/tax/scooter-models/${A.modelId}/classification`).set('Authorization', o).send({ taxClassificationId: cls.other }).expect(200);
      await http().put(`/api/v1/tax/accessories/${accessory.id}/classification`).set('Authorization', o).send({ taxClassificationId: null }).expect(200);
      await http().patch(`/api/v1/customers/${customer.body.id}`).set('Authorization', o).send({ gstStateCode: '27' }).expect(200);
      await patchSettings(A.owner, { gstNumber: GSTIN_27, gstStateCode: '27', gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT' }).expect(200);

      expect(await freeze()).toBe(before);
      // The commercial record is untouched too.
      expect((await prisma.sale.findFirstOrThrow({ where: { id: sale.id } })).total).toBe(1_203_000n);

      // Disabling GST afterwards leaves it in place as well.
      await patchSettings(A.owner, { gstEnabled: false }).expect(200);
      expect(await freeze()).toBe(before);
    });
  });
});
