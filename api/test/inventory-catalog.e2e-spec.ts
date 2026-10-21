import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { PURGE_ACTIVITY_LOG_SQL } from './support/e2e-company';

/**
 * M4A — inventory units attached to a CURATED variant (variantId) through the real endpoints, next to
 * the LEGACY free-text shape that still works until M4E.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company is
 * never read or changed.
 */
describe('Inventory ↔ catalogue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  let serial = 0;

  interface Co { id: string; token: string; modelId: string; variantId: string; inactiveVariantId: string; inactiveModelVariantId: string }
  const A = {} as Co;
  const B = {} as Co;

  const setupCompany = async (co: Co, label: string): Promise<void> => {
    co.id = (await prisma.company.create({ data: { name: `InvCat ${label} ${stamp}`, slug: `invcat-${label}-${stamp}` } })).id;
    const email = `invcat.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    co.token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    // Curated catalogue through the M2 API.
    co.modelId = (await http().post('/api/v1/inventory/models').set('Authorization', auth(co.token)).send({ brand: 'TESTBRAND', name: `Cat ${label} ${stamp}` }).expect(201)).body.id;
    co.variantId = (await http().post(`/api/v1/inventory/models/${co.modelId}/variants`).set('Authorization', auth(co.token)).send({ name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: 12_500_000, rangeKm: 120 }).expect(201)).body.id;
    co.inactiveVariantId = (await http().post(`/api/v1/inventory/models/${co.modelId}/variants`).set('Authorization', auth(co.token)).send({ name: 'Pro', colour: 'Retired', exShowroomPrice: 1 }).expect(201)).body.id;
    await http().patch(`/api/v1/inventory/variants/${co.inactiveVariantId}/active`).set('Authorization', auth(co.token)).send({ isActive: false }).expect(200);
    const inactiveModel = (await http().post('/api/v1/inventory/models').set('Authorization', auth(co.token)).send({ brand: 'TESTBRAND', name: `Old ${label} ${stamp}` }).expect(201)).body.id;
    co.inactiveModelVariantId = (await http().post(`/api/v1/inventory/models/${inactiveModel}/variants`).set('Authorization', auth(co.token)).send({ name: 'Base', colour: 'Grey', exShowroomPrice: 1 }).expect(201)).body.id;
    await http().patch(`/api/v1/inventory/models/${inactiveModel}/active`).set('Authorization', auth(co.token)).send({ isActive: false }).expect(200);
  };

  const ids = () => { const n = serial++; return { vin: `ICV${stamp}${n}`, motorNumber: `ICM${stamp}${n}`, batteryNumber: `ICB${stamp}${n}` }; };
  const create = (co: Co, body: Record<string, unknown>) => http().post('/api/v1/inventory/units').set('Authorization', auth(co.token)).send({ ...ids(), ...body });
  const patch = (co: Co, id: string, body: Record<string, unknown>) => http().patch(`/api/v1/inventory/units/${id}`).set('Authorization', auth(co.token)).send(body);
  const variantCount = (co: Co) => prisma.scooterVariant.count({ where: { companyId: co.id } });
  const unitCount = (co: Co) => prisma.inventoryUnit.count({ where: { companyId: co.id } });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await setupCompany(A, 'a');
    await setupCompany(B, 'b');
  }, 90000);

  afterAll(async () => {
    for (const id of [A.id, B.id].filter(Boolean)) {
      for (const sql of [
        PURGE_ACTIVITY_LOG_SQL,
        'DELETE FROM "InventoryEvent" WHERE "companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) await prisma.$executeRawUnsafe(sql, id);
    }
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  describe('create with a curated variant', () => {
    it('1 + 2 + 3 + 13. attaches the existing variant, creates nothing, keeps the response shape', async () => {
      const variantsBefore = await variantCount(A);
      const res = await create(A, { variantId: A.variantId, sellingPrice: 11_000_000, purchasePrice: 9_000_000 }).expect(201);
      expect(res.body.variant).toMatchObject({ id: A.variantId, name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: '12500000', model: { id: A.modelId, brand: 'TESTBRAND', name: `Cat a ${stamp}` } });
      expect(res.body).toMatchObject({ sellingPrice: '11000000', purchaseCost: '9000000', status: 'AVAILABLE' });
      expect(res.body.vin).toMatch(/^ICV/);
      expect(res.body.motorNumber).toMatch(/^ICM/);
      expect(res.body.batteryNumber).toMatch(/^ICB/);
      expect(await variantCount(A)).toBe(variantsBefore);
      const detail = await http().get(`/api/v1/inventory/units/${res.body.id}`).set('Authorization', auth(A.token)).expect(200);
      expect(detail.body.variant).toMatchObject({ id: A.variantId, model: { id: A.modelId } });
    });

    it('selling price omitted → the variant list price is the INITIAL unit price; a later list-price change leaves the unit alone', async () => {
      const res = await create(A, { variantId: A.variantId }).expect(201);
      expect(res.body.sellingPrice).toBe('12500000');
      await http().patch(`/api/v1/inventory/variants/${A.variantId}`).set('Authorization', auth(A.token)).send({ exShowroomPrice: 13_000_000 }).expect(200);
      expect((await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: res.body.id } })).sellingPrice).toBe(12_500_000n);
      await http().patch(`/api/v1/inventory/variants/${A.variantId}`).set('Authorization', auth(A.token)).send({ exShowroomPrice: 12_500_000 }).expect(200);
      // Explicit 0 stays 0 — the default applies only when the price is absent.
      expect((await create(A, { variantId: A.variantId, sellingPrice: 0 }).expect(201)).body.sellingPrice).toBe('0');
    });

    it('4. with both shapes, variantId wins and the free-text values are ignored — no variant is created', async () => {
      const before = await variantCount(A);
      const res = await create(A, { variantId: A.variantId, modelId: A.modelId, variant: 'Ghost', colour: 'Purple', hexColour: '#123456' }).expect(201);
      expect(res.body.variant).toMatchObject({ id: A.variantId, name: 'Pro', colour: 'Teal' });
      expect(await variantCount(A)).toBe(before);
      expect(await prisma.scooterVariant.count({ where: { companyId: A.id, name: 'Ghost' } })).toBe(0);
    });

    it('5 + 6. inactive variant / inactive model → 409, no unit', async () => {
      const before = await unitCount(A);
      expect((await create(A, { variantId: A.inactiveVariantId }).expect(409)).body.message).toContain('variant is inactive');
      expect((await create(A, { variantId: A.inactiveModelVariantId }).expect(409)).body.message).toContain('model of this variant is inactive');
      expect(await unitCount(A)).toBe(before);
    });

    it("7. another company's variant → 404, no unit", async () => {
      const before = await unitCount(A);
      await create(A, { variantId: B.variantId }).expect(404);
      await create(A, { variantId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await create(A, { variantId: 'not-a-uuid' }).expect(400);
      expect(await unitCount(A)).toBe(before);
    });

    it('a request with neither shape is a 400', async () => {
      await create(A, {}).expect(400);
      await create(A, { modelId: A.modelId, variant: 'Pro' }).expect(400); // colour missing
    });
  });

  describe('update with a curated variant', () => {
    it('8. re-points the unit to the existing variant; 9. with both shapes variantId wins', async () => {
      const second = (await http().post(`/api/v1/inventory/models/${A.modelId}/variants`).set('Authorization', auth(A.token)).send({ name: 'Pro', colour: 'Red', exShowroomPrice: 12_600_000 }).expect(201)).body.id;
      const unit = (await create(A, { variantId: A.variantId, sellingPrice: 11_000_000 }).expect(201)).body;
      const before = await variantCount(A);
      const res = await patch(A, unit.id, { variantId: second, modelId: A.modelId, variant: 'Ghost', colour: 'Purple' }).expect(200);
      expect(res.body.variant).toMatchObject({ id: second, name: 'Pro', colour: 'Red' });
      expect(res.body.sellingPrice).toBe('11000000'); // the unit's own price is untouched by a re-point
      expect(await variantCount(A)).toBe(before);
      // M4A keeps today's status behaviour: no guard yet (M4B).
      await http().patch(`/api/v1/inventory/units/${unit.id}/status`).set('Authorization', auth(A.token)).send({ toStatus: 'RESERVED' }).expect(200);
      await patch(A, unit.id, { variantId: A.variantId }).expect(200);
    });

    it("10. another company's variant → 404; inactive → 409; the unit is unchanged", async () => {
      const unit = (await create(A, { variantId: A.variantId }).expect(201)).body;
      await patch(A, unit.id, { variantId: B.variantId }).expect(404);
      await patch(A, unit.id, { variantId: A.inactiveVariantId }).expect(409);
      await patch(B, unit.id, { variantId: B.variantId }).expect(404); // B cannot even see A's unit
      expect((await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).variantId).toBe(A.variantId);
    });
  });

  describe('legacy free-text shape (until M4E)', () => {
    it('11. create still works and still creates a missing variant', async () => {
      const before = await variantCount(A);
      const res = await create(A, { modelId: A.modelId, variant: 'Legacy', colour: 'Blue', hexColour: '#0000FF', sellingPrice: 9_900_000 }).expect(201);
      expect(res.body.variant).toMatchObject({ name: 'Legacy', colour: 'Blue', hexColour: '#0000FF', exShowroomPrice: '9900000', model: { id: A.modelId } });
      expect(res.body.sellingPrice).toBe('9900000');
      expect(await variantCount(A)).toBe(before + 1);
      await create(A, { modelId: A.modelId, variant: 'Legacy', colour: 'Blue' }).expect(201); // reused
      expect(await variantCount(A)).toBe(before + 1);
      expect((await create(A, { modelId: A.modelId, variant: 'Legacy', colour: 'Blue' }).expect(201)).body.sellingPrice).toBe('0'); // legacy default unchanged
    });

    it('12. update still works and still re-points / creates by text', async () => {
      const unit = (await create(A, { variantId: A.variantId }).expect(201)).body;
      const before = await variantCount(A);
      const res = await patch(A, unit.id, { variant: 'Pro', colour: 'Teal' }).expect(200); // existing combination
      expect(res.body.variant.id).toBe(A.variantId);
      expect(await variantCount(A)).toBe(before);
      const moved = await patch(A, unit.id, { colour: 'Lime' }).expect(200); // new combination → new variant (legacy)
      expect(moved.body.variant).toMatchObject({ name: 'Pro', colour: 'Lime' });
      expect(await variantCount(A)).toBe(before + 1);
    });
  });
});
