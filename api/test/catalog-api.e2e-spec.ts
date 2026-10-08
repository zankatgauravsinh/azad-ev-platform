import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';

/**
 * Catalog M2 — the model / variant management API through HTTP: lists and filters, create / update /
 * activate, uniqueness, permissions, tenant isolation and the audit trail.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company is
 * never read or changed.
 */
describe('Catalog API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;

  interface Co { id: string; owner: string; ownerId: string }
  const A = {} as Co;
  const B = {} as Co;
  let viewer = ''; // inventory.view
  let creator = ''; // inventory.view + inventory.create
  let editor = ''; // inventory.view + inventory.update

  const login = async (email: string): Promise<string> => (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
  const setupCompany = async (co: Co, label: string): Promise<void> => {
    co.id = (await prisma.company.create({ data: { name: `CatApi ${label} ${stamp}`, slug: `catapi-${label}-${stamp}` } })).id;
    const email = `catapi.owner.${label}.${stamp}@e2e.test`;
    co.ownerId = (await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } })).id;
    co.owner = await login(email);
  };
  const limitedUser = async (label: string, keys: string[]): Promise<string> => {
    const role = await prisma.appRole.create({ data: { companyId: A.id, name: `CatApi ${label} ${stamp}`, isSystem: false } });
    for (const key of keys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const email = `catapi.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: A.id, name: label, email, role: 'SALES_EXECUTIVE', roleId: role.id, passwordHash: await bcrypt.hash('Test@12345', 12) } });
    return login(email);
  };

  const models = (token: string, qs = '') => http().get(`/api/v1/inventory/models${qs}`).set('Authorization', auth(token));
  const createModel = (token: string, body: Record<string, unknown>) => http().post('/api/v1/inventory/models').set('Authorization', auth(token)).send(body);
  const patchModel = (token: string, id: string, body: Record<string, unknown>) => http().patch(`/api/v1/inventory/models/${id}`).set('Authorization', auth(token)).send(body);
  const modelActive = (token: string, id: string, isActive: boolean) => http().patch(`/api/v1/inventory/models/${id}/active`).set('Authorization', auth(token)).send({ isActive });
  const variants = (token: string, qs = '') => http().get(`/api/v1/inventory/variants${qs}`).set('Authorization', auth(token));
  const createVariant = (token: string, modelId: string, body: Record<string, unknown>) => http().post(`/api/v1/inventory/models/${modelId}/variants`).set('Authorization', auth(token)).send(body);
  const patchVariant = (token: string, id: string, body: Record<string, unknown>) => http().patch(`/api/v1/inventory/variants/${id}`).set('Authorization', auth(token)).send(body);
  const variantActive = (token: string, id: string, isActive: boolean) => http().patch(`/api/v1/inventory/variants/${id}/active`).set('Authorization', auth(token)).send({ isActive });
  const audits = (entityType: string, entityId: string) => prisma.activityLog.findMany({ where: { companyId: A.id, entityType, entityId }, orderBy: { createdAt: 'asc' } });

  const VARIANT = { name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: 12_500_000, batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: 4.5, motorPowerW: 2500, warrantyMonths: 36 };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await setupCompany(A, 'a');
    await setupCompany(B, 'b');
    viewer = await limitedUser('viewer', ['inventory.view']);
    creator = await limitedUser('creator', ['inventory.view', 'inventory.create']);
    editor = await limitedUser('editor', ['inventory.view', 'inventory.update']);
  }, 90000);

  afterAll(async () => {
    for (const id of [A.id, B.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" WHERE "companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "AppRole" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) await prisma.$executeRawUnsafe(sql, id);
    }
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ───────────────────────── Models ─────────────────────────
  describe('models', () => {
    let vx = '';

    it('4. create: brand required, trimmed, empty description → null; returns the DTO with zero counts; audited', async () => {
      await createModel(A.owner, { name: `VX ${stamp}` }).expect(400); // no brand — nothing defaults it
      await createModel(A.owner, { brand: '  ', name: `VX ${stamp}` }).expect(400);
      const res = await createModel(A.owner, { brand: '  TESTBRAND ', name: `  VX ${stamp} `, description: '' }).expect(201);
      vx = res.body.id;
      expect(res.body).toEqual({ id: vx, brand: 'TESTBRAND', name: `VX ${stamp}`, description: null, isActive: true, taxClassificationId: null, variantCount: 0, unitCount: 0, createdAt: expect.any(String), updatedAt: expect.any(String) });
      for (const key of ['companyId', 'createdById', 'updatedById']) expect(res.body).not.toHaveProperty(key);
      // 27. CREATE audit
      const log = await audits('ScooterModel', vx);
      expect(log.map((l) => l.action)).toEqual(['CREATE']);
      expect(log[0]!.actorId).toBe(A.ownerId);
    });

    it('client-supplied companyId / audit / count fields are ignored, never applied', async () => {
      const res = await createModel(A.owner, { brand: 'TESTBRAND', name: `Ignored ${stamp}`, companyId: B.id, createdById: 'x', variantCount: 99, unitCount: 99 }).expect(201);
      expect(res.body).toMatchObject({ variantCount: 0, unitCount: 0 });
      expect((await prisma.scooterModel.findUniqueOrThrow({ where: { id: res.body.id } })).companyId).toBe(A.id);
    });

    it('5 + 6. duplicate name → 409, case-insensitive, even under a different brand', async () => {
      await createModel(A.owner, { brand: 'TESTBRAND', name: `vx ${stamp}` }).expect(409);
      await createModel(A.owner, { brand: 'OTHERBRAND', name: `VX ${stamp}` }).expect(409);
      // …but the same brand + name is fine for another company (tenant-scoped key).
      await createModel(B.owner, { brand: 'TESTBRAND', name: `VX ${stamp}` }).expect(201);
    });

    it('1 + 2 + 3. list: active by default, inactive / all on request, search by name or brand, counts', async () => {
      const inactive = (await createModel(A.owner, { brand: 'TESTBRAND', name: `Old ${stamp}` }).expect(201)).body.id;
      await modelActive(A.owner, inactive, false).expect(200);
      const active = (await models(A.owner).expect(200)).body as { id: string }[];
      expect(active.map((m) => m.id)).toContain(vx);
      expect(active.map((m) => m.id)).not.toContain(inactive);
      expect((await models(A.owner, '?status=inactive').expect(200)).body.map((m: { id: string }) => m.id)).toEqual([inactive]);
      const all = (await models(A.owner, '?status=all').expect(200)).body.map((m: { id: string }) => m.id);
      expect(all).toEqual(expect.arrayContaining([vx, inactive]));
      expect((await models(A.owner, `?q=old ${stamp}&status=all`).expect(200)).body.map((m: { id: string }) => m.id)).toEqual([inactive]);
      expect((await models(A.owner, '?q=testbrand').expect(200)).body.length).toBeGreaterThanOrEqual(1);
      expect((await models(A.owner, '?q=nothing-matches-this').expect(200)).body).toEqual([]);
      await models(A.owner, '?status=bogus').expect(400);
      // GET /inventory/models/:id works for an inactive model too (history stays resolvable).
      expect((await http().get(`/api/v1/inventory/models/${inactive}`).set('Authorization', auth(A.owner)).expect(200)).body).toMatchObject({ id: inactive, isActive: false });
    });

    it('7 + 8 + 28. update: edits brand/name/description, refuses isActive/taxClassificationId here, no-op writes no audit', async () => {
      const res = await patchModel(A.owner, vx, { description: 'Flagship', isActive: false, taxClassificationId: 'x', companyId: B.id }).expect(200);
      expect(res.body).toMatchObject({ id: vx, description: 'Flagship', isActive: true, taxClassificationId: null });
      expect((await prisma.scooterModel.findUniqueOrThrow({ where: { id: vx } })).companyId).toBe(A.id);
      let log = await audits('ScooterModel', vx);
      expect(log.at(-1)).toMatchObject({ action: 'UPDATE', metadata: { changes: { description: { from: null, to: 'Flagship' } } } });
      const count = log.length;
      await patchModel(A.owner, vx, { description: 'Flagship', brand: 'TESTBRAND' }).expect(200); // unchanged values
      log = await audits('ScooterModel', vx);
      expect(log.length).toBe(count);
      await patchModel(A.owner, vx, { name: `old ${stamp}` }).expect(409); // another model's name (inactive one still counts)
      await patchModel(A.owner, vx, { name: '' }).expect(400);
    });

    it('9 + 10 + 11 + 29. deactivate / reactivate: record kept, variants untouched, no-op writes no audit', async () => {
      const v = (await createVariant(A.owner, vx, VARIANT).expect(201)).body.id;
      await modelActive(A.owner, vx, false).expect(200);
      expect((await prisma.scooterModel.findUniqueOrThrow({ where: { id: vx } })).isActive).toBe(false);
      expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: v } })).isActive).toBe(true); // no cascade
      let log = await audits('ScooterModel', vx);
      expect(log.at(-1)).toMatchObject({ action: 'STATUS_CHANGE', metadata: { isActive: { from: true, to: false } } });
      const count = log.length;
      await modelActive(A.owner, vx, false).expect(200); // no-op
      expect((await audits('ScooterModel', vx)).length).toBe(count);
      await modelActive(A.owner, vx, true).expect(200);
      log = await audits('ScooterModel', vx);
      expect(log.length).toBe(count + 1);
      expect(log.at(-1)!.summary).toContain('Activated model');
      await modelActive(A.owner, vx, 'yes' as unknown as boolean).expect(400);
    });
  });

  // ───────────────────────── Variants ─────────────────────────
  describe('variants', () => {
    let modelId = '';
    let teal = '';
    beforeAll(async () => {
      modelId = (await createModel(A.owner, { brand: 'TESTBRAND', name: `Var ${stamp}` }).expect(201)).body.id;
    }, E2E_HOOK_TIMEOUT);

    it('14 + 30. create: full DTO with money as a string and the decimal as "4.50"; audited', async () => {
      const res = await createVariant(A.owner, modelId, { ...VARIANT, modelId: 'ignored', companyId: B.id }).expect(201);
      teal = res.body.id;
      expect(res.body).toEqual({
        id: teal, modelId, model: { id: modelId, brand: 'TESTBRAND', name: `Var ${stamp}` }, name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: '12500000',
        batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: '4.50', motorPowerW: 2500, warrantyMonths: 36, isActive: true, unitCount: 0,
        createdAt: expect.any(String), updatedAt: expect.any(String),
      });
      expect((await audits('ScooterVariant', teal)).map((l) => l.action)).toEqual(['CREATE']);
      await createVariant(A.owner, modelId, { name: 'Pro', colour: 'Red' }).expect(400); // price required
      await createVariant(A.owner, modelId, { ...VARIANT, colour: 'Red', hexColour: 'red' }).expect(400);
      await createVariant(A.owner, modelId, { ...VARIANT, colour: 'Red', exShowroomPrice: -1 }).expect(400);
    });

    it('15 + 16. same name + colour → 409; same name, another colour → allowed; colour stored as typed', async () => {
      await createVariant(A.owner, modelId, VARIANT).expect(409);
      const red = await createVariant(A.owner, modelId, { ...VARIANT, colour: 'Red' }).expect(201);
      const lower = await createVariant(A.owner, modelId, { ...VARIANT, colour: 'red' }).expect(201); // documented: no case folding of colour
      expect(red.body.colour).toBe('Red');
      expect(lower.body.colour).toBe('red');
    });

    it('13. list by model (active by default) with unit counts; GET /inventory/variants keeps its shape', async () => {
      const list = (await variants(A.owner, `?modelId=${modelId}`).expect(200)).body as { id: string; model: { id: string }; exShowroomPrice: string; unitCount: number }[];
      expect(list).toHaveLength(3);
      expect(list.every((v) => v.model.id === modelId && typeof v.exShowroomPrice === 'string' && v.unitCount === 0)).toBe(true);
      await variants(A.owner, '?modelId=not-a-uuid').expect(400);
    });

    it('17 + 18 + 19 + 31. update: before/after audited, no-op not audited, modelId cannot be changed', async () => {
      const other = (await createModel(A.owner, { brand: 'TESTBRAND', name: `Other ${stamp}` }).expect(201)).body.id;
      const res = await patchVariant(A.owner, teal, { exShowroomPrice: 12_900_000, rangeKm: 125, modelId: other, companyId: B.id }).expect(200);
      expect(res.body).toMatchObject({ id: teal, modelId, exShowroomPrice: '12900000', rangeKm: 125 });
      let log = await audits('ScooterVariant', teal);
      expect(log.at(-1)).toMatchObject({ action: 'UPDATE', metadata: { changes: { exShowroomPrice: { from: '12500000', to: '12900000' }, rangeKm: { from: 120, to: 125 } } } });
      const count = log.length;
      await patchVariant(A.owner, teal, { exShowroomPrice: 12_900_000, colour: 'Teal' }).expect(200); // no-op
      log = await audits('ScooterVariant', teal);
      expect(log.length).toBe(count);
      await patchVariant(A.owner, teal, { colour: 'Red' }).expect(409); // Pro / Red exists
      expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: teal } })).modelId).toBe(modelId);
    });

    it('20 + 21 + 32 + 33. deactivate / reactivate: kept for history, model untouched, no-op not audited', async () => {
      await variantActive(A.owner, teal, false).expect(200);
      expect((await variants(A.owner, `?modelId=${modelId}`).expect(200)).body.map((v: { id: string }) => v.id)).not.toContain(teal);
      expect((await variants(A.owner, `?modelId=${modelId}&status=all`).expect(200)).body.map((v: { id: string }) => v.id)).toContain(teal);
      expect((await prisma.scooterModel.findUniqueOrThrow({ where: { id: modelId } })).isActive).toBe(true);
      const count = (await audits('ScooterVariant', teal)).length;
      await variantActive(A.owner, teal, false).expect(200);
      expect((await audits('ScooterVariant', teal)).length).toBe(count);
      await variantActive(A.owner, teal, true).expect(200);
      expect((await audits('ScooterVariant', teal)).at(-1)).toMatchObject({ action: 'STATUS_CHANGE', metadata: { isActive: { from: false, to: true } } });
    });

    it('22. an inactive model does not accept new variants', async () => {
      await modelActive(A.owner, modelId, false).expect(200);
      await createVariant(A.owner, modelId, { ...VARIANT, colour: 'Blue' }).expect(409);
      await modelActive(A.owner, modelId, true).expect(200);
      await createVariant(A.owner, modelId, { ...VARIANT, colour: 'Blue' }).expect(201);
    });

    it('the list price is a catalogue value only: no unit, booking or quotation is touched', async () => {
      const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(A.owner))
        .send({ modelId, variant: 'Pro', colour: 'Teal', vin: `CATAPI${stamp}1`, motorNumber: `CATM${stamp}1`, batteryNumber: `CATB${stamp}1`, sellingPrice: 11_000_000 }).expect(201);
      expect(unit.body.variant.id).toBe(teal); // the existing implicit path resolves the curated variant (exact key match)
      await patchVariant(A.owner, teal, { exShowroomPrice: 13_000_000 }).expect(200);
      expect((await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.body.id } })).sellingPrice).toBe(11_000_000n);
      expect((await variants(A.owner, `?modelId=${modelId}`).expect(200)).body.find((v: { id: string }) => v.id === teal).unitCount).toBe(1);
    });
  });

  // ───────────────────────── Authorization ─────────────────────────
  describe('authorization', () => {
    let modelId = '';
    let variantId = '';
    beforeAll(async () => {
      modelId = (await createModel(A.owner, { brand: 'TESTBRAND', name: `Auth ${stamp}` }).expect(201)).body.id;
      variantId = (await createVariant(A.owner, modelId, VARIANT).expect(201)).body.id;
    }, E2E_HOOK_TIMEOUT);

    it('24. unauthenticated → 401 everywhere', async () => {
      await http().get('/api/v1/inventory/models').expect(401);
      await http().post('/api/v1/inventory/models').send({ brand: 'X', name: 'Y' }).expect(401);
      await http().patch(`/api/v1/inventory/models/${modelId}`).send({ description: 'x' }).expect(401);
      await http().patch(`/api/v1/inventory/variants/${variantId}/active`).send({ isActive: false }).expect(401);
    });

    it('25 + 26. inventory.view reads only; inventory.create creates; inventory.update edits and activates', async () => {
      await models(viewer).expect(200);
      await variants(viewer, `?modelId=${modelId}`).expect(200);
      await createModel(viewer, { brand: 'TESTBRAND', name: `Denied ${stamp}` }).expect(403);
      await createVariant(viewer, modelId, { ...VARIANT, colour: 'Grey' }).expect(403);
      await patchModel(viewer, modelId, { description: 'x' }).expect(403);
      await variantActive(viewer, variantId, false).expect(403);

      await createModel(creator, { brand: 'TESTBRAND', name: `Created ${stamp}` }).expect(201);
      await createVariant(creator, modelId, { ...VARIANT, colour: 'Grey' }).expect(201);
      await patchModel(creator, modelId, { description: 'x' }).expect(403);
      await modelActive(creator, modelId, false).expect(403);

      await patchModel(editor, modelId, { description: 'By editor' }).expect(200);
      await patchVariant(editor, variantId, { rangeKm: 99 }).expect(200);
      await variantActive(editor, variantId, false).expect(200);
      await variantActive(editor, variantId, true).expect(200);
      await createModel(editor, { brand: 'TESTBRAND', name: `Editor ${stamp}` }).expect(403);
    });
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  describe('12 + 23. tenant isolation', () => {
    it("company B gets 404 for every operation on company A's model and variant, and nothing changes", async () => {
      const modelId = (await createModel(A.owner, { brand: 'TESTBRAND', name: `Iso ${stamp}` }).expect(201)).body.id;
      const variantId = (await createVariant(A.owner, modelId, VARIANT).expect(201)).body.id;
      await http().get(`/api/v1/inventory/models/${modelId}`).set('Authorization', auth(B.owner)).expect(404);
      await patchModel(B.owner, modelId, { name: 'Hijacked' }).expect(404);
      await modelActive(B.owner, modelId, false).expect(404);
      await createVariant(B.owner, modelId, { ...VARIANT, colour: 'Black' }).expect(404);
      await patchVariant(B.owner, variantId, { colour: 'Black' }).expect(404);
      await variantActive(B.owner, variantId, false).expect(404);
      expect((await models(B.owner, '?status=all').expect(200)).body.map((m: { id: string }) => m.id)).not.toContain(modelId);
      expect((await variants(B.owner, `?modelId=${modelId}&status=all`).expect(200)).body).toEqual([]);
      expect(await prisma.scooterModel.findUniqueOrThrow({ where: { id: modelId } })).toMatchObject({ name: `Iso ${stamp}`, isActive: true });
      expect(await prisma.scooterVariant.findUniqueOrThrow({ where: { id: variantId } })).toMatchObject({ colour: 'Teal', isActive: true });
      expect(await prisma.scooterVariant.count({ where: { modelId } })).toBe(1);
      expect(await prisma.activityLog.count({ where: { companyId: B.id, entityId: { in: [modelId, variantId] } } })).toBe(0); // nothing of A's was ever touched from B
    });
  });
});
