import { ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { TenantContext } from '../src/tenant/tenant-context.service';
import { CatalogRepository } from '../src/modules/inventory/catalog/catalog.repository';
import { CatalogService } from '../src/modules/inventory/catalog/catalog.service';

/**
 * Catalog M1 against the real database: tenant-scoped uniqueness (the new (companyId, brand, name) key),
 * cross-tenant isolation of models and variants, inactive records, counts, the exact variant key and the
 * audit trail. No HTTP endpoint exists yet; the service runs inside a tenant context, as M2's controller
 * will call it.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company is
 * never read or changed.
 */
describe('Catalog foundation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantContext;
  let service: CatalogService;
  let repo: CatalogRepository;
  const stamp = Date.now().toString().slice(-8);
  let coA = '';
  let coB = '';
  let USER = ''; // a real user of company A: ActivityLog.actorId is a foreign key

  const inA = <T>(fn: () => Promise<T>): Promise<T> => tenant.runWith(coA, fn);
  const inB = <T>(fn: () => Promise<T>): Promise<T> => tenant.runWith(coB, fn);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    tenant = app.get(TenantContext);
    service = app.get(CatalogService);
    repo = app.get(CatalogRepository);
    coA = (await prisma.company.create({ data: { name: `Catalog A ${stamp}`, slug: `catalog-a-${stamp}` } })).id;
    coB = (await prisma.company.create({ data: { name: `Catalog B ${stamp}`, slug: `catalog-b-${stamp}` } })).id;
    USER = (await prisma.user.create({ data: { companyId: coA, name: 'Catalog Tester', email: `catalog.${stamp}@e2e.test`, role: 'OWNER', passwordHash: 'test-only' } })).id;
  }, 60000);

  afterAll(async () => {
    for (const id of [coA, coB].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
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

  // ───────────────────────── Tenant-scoped uniqueness ─────────────────────────
  describe('model uniqueness', () => {
    it('two companies may each have the same brand + name; within a company it is refused', async () => {
      const a = await inA(() => service.createModel({ brand: 'TESTBRAND', name: `VX ${stamp}` }, USER));
      const b = await inB(() => service.createModel({ brand: 'TESTBRAND', name: `VX ${stamp}` }, USER));
      expect(a.id).not.toBe(b.id);
      await expect(inA(() => service.createModel({ brand: 'TESTBRAND', name: `vx ${stamp}` }, USER))).rejects.toBeInstanceOf(ConflictException); // case-insensitive
      await expect(inA(() => service.createModel({ brand: 'OTHERBRAND', name: `VX ${stamp}` }, USER))).rejects.toBeInstanceOf(ConflictException); // existing rule: name unique across brands
    });

    it('the database key itself is (companyId, brand, name)', async () => {
      // Bypass the service: the same brand+name in another company is allowed by the index…
      await prisma.scooterModel.create({ data: { companyId: coB, brand: 'TESTBRAND', name: `Key ${stamp}` } });
      await prisma.scooterModel.create({ data: { companyId: coA, brand: 'TESTBRAND', name: `Key ${stamp}` } });
      // …and a duplicate within one company is refused by the index.
      await expect(prisma.scooterModel.create({ data: { companyId: coA, brand: 'TESTBRAND', name: `Key ${stamp}` } })).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ───────────────────────── Cross-tenant isolation ─────────────────────────
  describe('cross-tenant isolation', () => {
    let aModel = '';
    let aVariant = '';
    beforeAll(async () => {
      aModel = (await inA(() => service.createModel({ brand: 'TESTBRAND', name: `Iso ${stamp}` }, USER))).id;
      aVariant = (await inA(() => service.createVariant(aModel, { name: 'Pro', colour: 'Red', exShowroomPrice: 12_000_000 }, USER))).id;
    }, E2E_HOOK_TIMEOUT);

    it("company B cannot read, update or deactivate company A's model", async () => {
      await expect(inB(() => service.getModel(aModel))).rejects.toBeInstanceOf(NotFoundException);
      await expect(inB(() => service.updateModel(aModel, { name: 'Hijacked' }, USER))).rejects.toBeInstanceOf(NotFoundException);
      await expect(inB(() => service.setModelActive(aModel, false, USER))).rejects.toBeInstanceOf(NotFoundException);
      expect(await inB(() => repo.updateModel(coB, aModel, { name: 'Hijacked' }))).toBe(0); // even the repository write is scoped
      const row = await prisma.scooterModel.findUniqueOrThrow({ where: { id: aModel } });
      expect(row).toMatchObject({ name: `Iso ${stamp}`, isActive: true });
      expect(await inB(() => service.listModels({ includeInactive: true }))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: aModel })]));
    });

    it("company B cannot read, update or deactivate company A's variant, nor add a variant under A's model", async () => {
      await expect(inB(() => service.getVariant(aVariant))).rejects.toBeInstanceOf(NotFoundException);
      await expect(inB(() => service.updateVariant(aVariant, { colour: 'Blue' }, USER))).rejects.toBeInstanceOf(NotFoundException);
      await expect(inB(() => service.setVariantActive(aVariant, false, USER))).rejects.toBeInstanceOf(NotFoundException);
      await expect(inB(() => service.createVariant(aModel, { name: 'Pro', colour: 'Blue', exShowroomPrice: 1 }, USER))).rejects.toBeInstanceOf(NotFoundException);
      expect(await inB(() => repo.updateVariant(coB, aVariant, { colour: 'Blue' }))).toBe(0);
      expect(await prisma.scooterVariant.count({ where: { modelId: aModel } })).toBe(1);
      expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: aVariant } })).colour).toBe('Red');
      expect(await inB(() => service.listVariants({ includeInactive: true }))).toEqual([]);
    });

    it('company A reads its own records', async () => {
      await expect(inA(() => service.getModel(aModel))).resolves.toMatchObject({ id: aModel });
      await expect(inA(() => service.getVariant(aVariant))).resolves.toMatchObject({ id: aVariant, model: { id: aModel } });
    });
  });

  // ───────────────────────── Variants, inactive records, counts ─────────────────────────
  describe('variants and lifecycle', () => {
    let modelId = '';
    beforeAll(async () => {
      modelId = (await inA(() => service.createModel({ brand: 'TESTBRAND', name: `Life ${stamp}`, description: 'Flagship' }, USER))).id;
    }, E2E_HOOK_TIMEOUT);

    it('the variant key is exact: a different case or a different colour is another variant; the same key is refused', async () => {
      const red = await inA(() => service.createVariant(modelId, { name: 'Pro', colour: 'Red', exShowroomPrice: 10_000_000 }, USER));
      const lower = await inA(() => service.createVariant(modelId, { name: 'Pro', colour: 'red', exShowroomPrice: 10_000_000 }, USER)); // documented: no case folding
      const blue = await inA(() => service.createVariant(modelId, { name: 'Pro', colour: 'Blue', exShowroomPrice: 10_000_000 }, USER));
      expect(new Set([red.id, lower.id, blue.id]).size).toBe(3);
      await expect(inA(() => service.createVariant(modelId, { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, USER))).rejects.toBeInstanceOf(ConflictException);
      await expect(inA(() => service.updateVariant(blue.id, { colour: 'Red' }, USER))).rejects.toBeInstanceOf(ConflictException);
      expect(await inA(() => service.listVariants({ modelId }))).toHaveLength(3);
    });

    it('deactivated models and variants leave the lookup lists but stay readable by id', async () => {
      const variants = await inA(() => service.listVariants({ modelId }));
      const v = variants[0]!;
      await inA(() => service.setVariantActive(v.id, false, USER));
      expect((await inA(() => service.listVariants({ modelId }))).map((x) => x.id)).not.toContain(v.id);
      expect((await inA(() => service.listVariants({ modelId, includeInactive: true }))).map((x) => x.id)).toContain(v.id);
      await expect(inA(() => service.getVariant(v.id))).resolves.toMatchObject({ isActive: false });

      await inA(() => service.setModelActive(modelId, false, USER));
      expect((await inA(() => service.listModels())).map((m) => m.id)).not.toContain(modelId);
      expect((await inA(() => service.listModels({ includeInactive: true }))).map((m) => m.id)).toContain(modelId);
      await expect(inA(() => service.getModel(modelId))).resolves.toMatchObject({ isActive: false });
      // The existing GET /inventory/models behaviour (active only) is what listModels() serves.
      await inA(() => service.setModelActive(modelId, true, USER));
    });

    it('variant and unit counts are per company and ignore soft-deleted units', async () => {
      const variants = await inA(() => service.listVariants({ modelId, includeInactive: true }));
      const v = variants.find((x) => x.isActive)!;
      const unit = (vin: string, deletedAt: Date | null) =>
        prisma.inventoryUnit.create({ data: { companyId: coA, variantId: v.id, vin, motorNumber: `M${vin}`, batteryNumber: `B${vin}`, deletedAt } });
      await unit(`CATV${stamp}1`, null);
      await unit(`CATV${stamp}2`, null);
      await unit(`CATV${stamp}3`, new Date()); // soft-deleted: not on the books
      const dto = await inA(async () => service.modelDto(await service.getModel(modelId)));
      expect(dto).toMatchObject({ variantCount: 3, unitCount: 2, description: 'Flagship', taxClassificationId: null });
      const vdto = await inA(async () => service.variantDto(await service.getVariant(v.id)));
      expect(vdto.unitCount).toBe(2);
      expect(await inB(() => repo.countModelUnits(coB, modelId))).toBe(0);
      expect(await inB(() => repo.countVariants(coB, modelId))).toBe(0);
    });

    it('updates write only the given fields and record before/after in the activity log', async () => {
      const before = await prisma.activityLog.count({ where: { companyId: coA, entityType: 'ScooterModel', entityId: modelId } });
      const updated = await inA(() => service.updateModel(modelId, { description: 'Flagship 2026' }, USER));
      expect(updated).toMatchObject({ name: `Life ${stamp}`, brand: 'TESTBRAND', description: 'Flagship 2026', isActive: true });
      const logs = await prisma.activityLog.findMany({ where: { companyId: coA, entityType: 'ScooterModel', entityId: modelId }, orderBy: { createdAt: 'asc' } });
      expect(logs.length).toBe(before + 1);
      expect(logs.at(-1)).toMatchObject({ action: 'UPDATE', summary: `Updated model TESTBRAND Life ${stamp}: description Flagship → Flagship 2026`, metadata: { changes: { description: { from: 'Flagship', to: 'Flagship 2026' } } } });
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['CREATE', 'STATUS_CHANGE', 'UPDATE']));

      const v = (await inA(() => service.listVariants({ modelId })))[0]!;
      await inA(() => service.updateVariant(v.id, { exShowroomPrice: 10_500_000, rangeKm: 120, chargingTimeHrs: 4.5 }, USER));
      const vlog = await prisma.activityLog.findFirst({ where: { companyId: coA, entityType: 'ScooterVariant', entityId: v.id, action: 'UPDATE' } });
      expect(vlog?.metadata).toEqual({ changes: { exShowroomPrice: { from: '10000000', to: '10500000' }, rangeKm: { from: null, to: 120 }, chargingTimeHrs: { from: null, to: '4.5' } } });
      expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: v.id } })).chargingTimeHrs).toEqual(new Prisma.Decimal('4.5'));
    });
  });
});
