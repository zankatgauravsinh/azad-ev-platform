import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogService } from './catalog.service';
import type { CatalogRepository, ModelRow, VariantRow } from './catalog.repository';
import type { ActivityLogService } from '../../../activity-log/activity-log.service';
import type { TenantContext } from '../../../tenant/tenant-context.service';

const CO = 'company-a';
const TX = { tx: true };
const model = (over: Partial<ModelRow> = {}): ModelRow => ({ id: 'm1', brand: 'TESTBRAND', name: 'VX', description: null, isActive: true, taxClassificationId: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over });
const variant = (over: Partial<VariantRow> = {}): VariantRow => ({
  id: 'v1', companyId: CO, modelId: 'm1', model: { id: 'm1', brand: 'TESTBRAND', name: 'VX' }, name: 'Pro', colour: 'Red', hexColour: null, exShowroomPrice: 12_000_000n,
  batteryType: null, batteryCapacity: null, rangeKm: null, topSpeedKmph: null, chargingTimeHrs: null, motorPowerW: null, warrantyMonths: null, isActive: true,
  createdById: 'u1', updatedById: 'u1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});

describe('CatalogService', () => {
  let repo: Record<keyof CatalogRepository, jest.Mock>;
  let log: { record: jest.Mock };
  let service: CatalogService;

  beforeEach(() => {
    repo = {
      listModels: jest.fn().mockResolvedValue([]), findModelById: jest.fn().mockResolvedValue(model()), findModelByName: jest.fn().mockResolvedValue(null), findModelByBrandAndName: jest.fn(),
      countVariants: jest.fn().mockResolvedValue(2), countModelUnits: jest.fn().mockResolvedValue(5), createModel: jest.fn(), updateModel: jest.fn().mockResolvedValue(1), setModelActive: jest.fn().mockResolvedValue(1),
      listVariants: jest.fn().mockResolvedValue([]), findVariantById: jest.fn().mockResolvedValue(variant()), findVariantByKey: jest.fn().mockResolvedValue(null), countVariantUnits: jest.fn().mockResolvedValue(3),
      createVariant: jest.fn(), updateVariant: jest.fn().mockResolvedValue(1), setVariantActive: jest.fn().mockResolvedValue(1),
      // M4B.5 — nothing is locked by default; the transaction runs its callback with a dummy client.
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)),
      lockedModelIds: jest.fn().mockResolvedValue(new Set()), lockedVariantIds: jest.fn().mockResolvedValue(new Set()),
      isModelIdentityLocked: jest.fn().mockResolvedValue(false), isVariantIdentityLocked: jest.fn().mockResolvedValue(false),
      lockModelForIdentityChange: jest.fn().mockResolvedValue('LOCKED'), lockVariantForIdentityChange: jest.fn().mockResolvedValue('LOCKED'),
    } as unknown as Record<keyof CatalogRepository, jest.Mock>;
    log = { record: jest.fn().mockResolvedValue(undefined) };
    const tenant = { requireCompanyId: () => CO } as unknown as TenantContext;
    service = new CatalogService(repo as unknown as CatalogRepository, tenant, log as unknown as ActivityLogService);
  });

  describe('tenant scoping — the actor\'s company goes into every repository call', () => {
    it('1. model lookups', async () => {
      await service.listModels({ includeInactive: true });
      expect(repo.listModels).toHaveBeenCalledWith(CO, { includeInactive: true });
      await service.getModel('m1');
      expect(repo.findModelById).toHaveBeenCalledWith(CO, 'm1');
    });

    it('7. variant lookups', async () => {
      await service.listVariants({ modelId: 'm1' });
      expect(repo.listVariants).toHaveBeenCalledWith(CO, { modelId: 'm1' });
      await service.getVariant('v1');
      expect(repo.findVariantById).toHaveBeenCalledWith(CO, 'v1');
    });

    it('3 + 9. a record the repository does not return for this company is not found — and nothing is written', async () => {
      repo.findModelById.mockResolvedValue(null);
      repo.findVariantById.mockResolvedValue(null);
      await expect(service.getModel('other-co-model')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.updateModel('other-co-model', { name: 'X' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setModelActive('other-co-model', false, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getVariant('other-co-variant')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.updateVariant('other-co-variant', { colour: 'Blue' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setVariantActive('other-co-variant', false, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      for (const fn of ['updateModel', 'setModelActive', 'updateVariant', 'setVariantActive', 'createVariant'] as const) expect(repo[fn]).not.toHaveBeenCalled();
      expect(log.record).not.toHaveBeenCalled();
    });

    it('8. a variant cannot be created under a model the company does not own', async () => {
      repo.findModelById.mockResolvedValue(null);
      await expect(service.createVariant('other-co-model', { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.createVariant).not.toHaveBeenCalled();
    });

    it('22. an inactive model does not accept new variants', async () => {
      repo.findModelById.mockResolvedValue(model({ isActive: false }));
      await expect(service.createVariant('m1', { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createVariant).not.toHaveBeenCalled();
    });

    it('a scoped write that matched no row (raced away or foreign) is reported as not found', async () => {
      repo.updateModel.mockResolvedValue(0);
      await expect(service.updateModel('m1', { description: 'x' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      expect(log.record).not.toHaveBeenCalled();
    });
  });

  describe('uniqueness', () => {
    it('2. a model name already used in the company is refused (case-insensitive, across brands), even for another brand', async () => {
      repo.findModelByName.mockResolvedValue(model({ id: 'm9', name: 'vx', brand: 'OTHER' }));
      await expect(service.createModel({ brand: 'TESTBRAND', name: 'VX' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.updateModel('m1', { name: 'VX' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createModel).not.toHaveBeenCalled();
      expect(repo.updateModel).not.toHaveBeenCalled();
    });

    it('a model keeps its own name on update', async () => {
      repo.findModelByName.mockResolvedValue(model());
      repo.findModelById.mockResolvedValueOnce(model()).mockResolvedValueOnce(model({ description: 'Updated' }));
      await expect(service.updateModel('m1', { name: 'VX', description: 'Updated' }, 'u1')).resolves.toMatchObject({ description: 'Updated' });
    });

    it('10. a variant key (model, name, colour) already used is refused; the same variant may keep its key', async () => {
      repo.findVariantByKey.mockResolvedValue(variant({ id: 'v9' }));
      await expect(service.createVariant('m1', { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.updateVariant('v1', { colour: 'Red' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
      repo.findVariantByKey.mockResolvedValue(variant({ id: 'v1' }));
      await expect(service.updateVariant('v1', { colour: 'Red' }, 'u1')).resolves.toBeDefined();
    });

    it('a concurrent create that loses the race on the database key surfaces as the same 409', async () => {
      repo.createModel.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
      await expect(service.createModel({ brand: 'TESTBRAND', name: 'VX' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('inactive records and counts', () => {
    it('4 + 11. inactive models and variants are still found by id (history stays valid); lists hide them unless asked', async () => {
      repo.findModelById.mockResolvedValue(model({ isActive: false }));
      repo.findVariantById.mockResolvedValue(variant({ isActive: false }));
      await expect(service.getModel('m1')).resolves.toMatchObject({ isActive: false });
      await expect(service.getVariant('v1')).resolves.toMatchObject({ isActive: false });
      await service.listModels();
      expect(repo.listModels).toHaveBeenCalledWith(CO, {});
    });

    it('5 + 6 + 12. counts come from the scoped repository and ride on the DTOs', async () => {
      await expect(service.modelDto(model())).resolves.toMatchObject({ id: 'm1', variantCount: 2, unitCount: 5, taxClassificationId: null });
      expect(repo.countVariants).toHaveBeenCalledWith(CO, 'm1');
      expect(repo.countModelUnits).toHaveBeenCalledWith(CO, 'm1');
      await expect(service.variantDto(variant({ chargingTimeHrs: new Prisma.Decimal('4.5') }))).resolves.toMatchObject({ unitCount: 3, exShowroomPrice: '12000000', chargingTimeHrs: '4.50' });
      expect(repo.countVariantUnits).toHaveBeenCalledWith(CO, 'v1');
    });
  });

  describe('audit', () => {
    it('13. model create records a CREATE event with the fields', async () => {
      repo.createModel.mockResolvedValue(model({ description: 'Flagship' }));
      await service.createModel({ brand: 'TESTBRAND', name: 'VX', description: 'Flagship' }, 'u1');
      expect(repo.createModel).toHaveBeenCalledWith(CO, { brand: 'TESTBRAND', name: 'VX', description: 'Flagship', isActive: true, createdById: 'u1', updatedById: 'u1' });
      expect(log.record).toHaveBeenCalledWith({
        actorId: 'u1', action: 'CREATE', entityType: 'ScooterModel', entityId: 'm1', entityLabel: 'TESTBRAND VX', summary: 'Created model TESTBRAND VX',
        metadata: { brand: 'TESTBRAND', name: 'VX', description: 'Flagship', isActive: true },
        changes: { brand: { from: null, to: 'TESTBRAND' }, name: { from: null, to: 'VX' }, description: { from: null, to: 'Flagship' }, isActive: { from: null, to: true } },
      });
    });

    it('14. model update records before/after for what changed, and nothing when nothing changed', async () => {
      repo.findModelById.mockResolvedValueOnce(model()).mockResolvedValueOnce(model({ name: 'VX Pro' }));
      await service.updateModel('m1', { name: 'VX Pro' }, 'u1');
      // A name change is an identity change: written inside the lock-protocol transaction (M4B.5).
      expect(repo.updateModel).toHaveBeenCalledWith(CO, 'm1', { updatedById: 'u1', name: 'VX Pro' }, TX);
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'ScooterModel', metadata: { changes: { name: { from: 'VX', to: 'VX Pro' } } } }));
      log.record.mockClear();
      repo.findModelById.mockResolvedValue(model());
      await service.updateModel('m1', { description: undefined }, 'u1');
      expect(log.record).not.toHaveBeenCalled();
    });

    it('15. deactivating / activating a model records STATUS_CHANGE; a no-op change records nothing', async () => {
      repo.findModelById.mockResolvedValueOnce(model()).mockResolvedValueOnce(model({ isActive: false }));
      await expect(service.setModelActive('m1', false, 'u1')).resolves.toMatchObject({ isActive: false });
      expect(repo.setModelActive).toHaveBeenCalledWith(CO, 'm1', false, 'u1');
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'STATUS_CHANGE', summary: 'Deactivated model TESTBRAND VX', metadata: { isActive: { from: true, to: false } } }));
      log.record.mockClear();
      repo.findModelById.mockResolvedValue(model());
      await service.setModelActive('m1', true, 'u1');
      expect(repo.setModelActive).toHaveBeenCalledTimes(1);
      expect(log.record).not.toHaveBeenCalled();
    });

    it('16. variant create records a CREATE event and converts money / decimals for storage', async () => {
      repo.createVariant.mockResolvedValue(variant({ chargingTimeHrs: new Prisma.Decimal('4.5') }));
      await service.createVariant('m1', { name: 'Pro', colour: 'Red', exShowroomPrice: 12_000_000, chargingTimeHrs: 4.5, rangeKm: 100 }, 'u1');
      expect(repo.createVariant).toHaveBeenCalledWith(CO, expect.objectContaining({ modelId: 'm1', name: 'Pro', colour: 'Red', exShowroomPrice: 12_000_000n, rangeKm: 100, chargingTimeHrs: new Prisma.Decimal(4.5), isActive: true, createdById: 'u1' }));
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityType: 'ScooterVariant', entityId: 'v1', summary: 'Created variant TESTBRAND VX Pro (Red)', metadata: expect.objectContaining({ exShowroomPrice: '12000000', colour: 'Red' }) }));
    });

    it('17. variant update records before/after', async () => {
      repo.findVariantById.mockResolvedValueOnce(variant()).mockResolvedValueOnce(variant({ exShowroomPrice: 12_500_000n, colour: 'Blue' }));
      await service.updateVariant('v1', { exShowroomPrice: 12_500_000, colour: 'Blue' }, 'u1');
      // A colour change is an identity change: written inside the lock-protocol transaction (M4B.5).
      expect(repo.updateVariant).toHaveBeenCalledWith(CO, 'v1', { updatedById: 'u1', colour: 'Blue', exShowroomPrice: 12_500_000n }, TX);
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'ScooterVariant', metadata: { changes: { colour: { from: 'Red', to: 'Blue' }, exShowroomPrice: { from: '12000000', to: '12500000' } } } }));
    });

    it('18. variant deactivation records STATUS_CHANGE', async () => {
      repo.findVariantById.mockResolvedValueOnce(variant()).mockResolvedValueOnce(variant({ isActive: false }));
      await service.setVariantActive('v1', false, 'u1');
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'STATUS_CHANGE', entityType: 'ScooterVariant', summary: 'Deactivated variant TESTBRAND VX Pro (Red)' }));
    });
  });
  describe('identity lock (M4B.5)', () => {
    const MODEL_LOCKED = 'Model brand/name cannot be changed: vehicles of this model are booked, delivered or have sale, warranty or AMC history. Add a new model instead.';
    const VARIANT_LOCKED = 'Variant name/colour cannot be changed: vehicles of this variant are booked, delivered or have sale, warranty or AMC history. Add a new variant instead.';
    const nothingWritten = () => {
      for (const fn of ['updateModel', 'updateVariant', 'setModelActive', 'setVariantActive'] as const) expect(repo[fn]).not.toHaveBeenCalled();
      expect(log.record).not.toHaveBeenCalled();
    };

    describe('models', () => {
      it.each([[{ name: 'VX Pro' }], [{ brand: 'OTHER' }], [{ name: 'vx' }], [{ name: 'VX', brand: 'testbrand' }]])('a locked model refuses %o (409) before the name check; nothing written, even a description sent alongside', async (change) => {
        repo.isModelIdentityLocked.mockResolvedValue(true);
        await expect(service.updateModel('m1', { ...change, description: 'new' }, 'u1')).rejects.toMatchObject({ status: 409, message: MODEL_LOCKED });
        expect(repo.isModelIdentityLocked).toHaveBeenCalledWith(CO, 'm1');
        expect(repo.findModelByName).not.toHaveBeenCalled();
        expect(repo.transaction).not.toHaveBeenCalled();
        nothingWritten();
      });

      it('an unlocked model is renamed under the lock protocol: lock → re-check → write, all in one transaction', async () => {
        await service.updateModel('m1', { name: 'VX Pro', brand: 'NEWBRAND' }, 'u1');
        expect(repo.lockModelForIdentityChange).toHaveBeenCalledWith(CO, 'm1', TX);
        expect(repo.isModelIdentityLocked).toHaveBeenLastCalledWith(CO, 'm1', TX);
        expect(repo.updateModel).toHaveBeenCalledWith(CO, 'm1', { updatedById: 'u1', name: 'VX Pro', brand: 'NEWBRAND' }, TX);
        const recheck = repo.isModelIdentityLocked.mock.invocationCallOrder.at(-1)!;
        expect(repo.lockModelForIdentityChange.mock.invocationCallOrder[0]).toBeLessThan(recheck);
        expect(recheck).toBeLessThan(repo.updateModel.mock.invocationCallOrder[0]!);
      });

      it('a lock that appears between the fast check and the lock protocol is caught under the lock (409, nothing written)', async () => {
        repo.isModelIdentityLocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await expect(service.updateModel('m1', { name: 'VX Pro' }, 'u1')).rejects.toMatchObject({ status: 409, message: MODEL_LOCKED });
        nothingWritten();
      });

      it('a model that is no longer this company\'s by the time it is locked is not found', async () => {
        repo.lockModelForIdentityChange.mockResolvedValue('NOT_FOUND');
        await expect(service.updateModel('m1', { name: 'VX Pro' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.updateModel).not.toHaveBeenCalled();
      });

      it('case-only and inner-spacing differences are changes; the stored value sent back is not', async () => {
        repo.findModelById.mockResolvedValue(model({ name: 'V  X' }));
        await service.updateModel('m1', { name: 'V X' }, 'u1');
        expect(repo.lockModelForIdentityChange).toHaveBeenCalledTimes(1);
        repo.lockModelForIdentityChange.mockClear();
        repo.transaction.mockClear();
        await service.updateModel('m1', { name: 'V  X', brand: 'TESTBRAND' }, 'u1');
        expect(repo.transaction).not.toHaveBeenCalled();
        expect(repo.lockModelForIdentityChange).not.toHaveBeenCalled();
      });

      it('a locked model keeps description and active / inactive editable — no lock check, no transaction', async () => {
        repo.isModelIdentityLocked.mockResolvedValue(true);
        repo.findModelById.mockResolvedValueOnce(model()).mockResolvedValueOnce(model({ description: 'd' }));
        await service.updateModel('m1', { description: 'd' }, 'u1');
        expect(repo.updateModel).toHaveBeenCalledWith(CO, 'm1', { updatedById: 'u1', description: 'd' });
        await service.setModelActive('m1', false, 'u1');
        expect(repo.setModelActive).toHaveBeenCalledWith(CO, 'm1', false, 'u1');
        expect(repo.isModelIdentityLocked).not.toHaveBeenCalled();
        expect(repo.transaction).not.toHaveBeenCalled();
      });
    });

    describe('variants', () => {
      it.each([[{ name: 'Max' }], [{ colour: 'Blue' }], [{ colour: 'red' }], [{ name: 'pro' }]])('a locked variant refuses %o (409) before the key check; nothing written, even a price sent alongside', async (change) => {
        repo.isVariantIdentityLocked.mockResolvedValue(true);
        await expect(service.updateVariant('v1', { ...change, exShowroomPrice: 1 }, 'u1')).rejects.toMatchObject({ status: 409, message: VARIANT_LOCKED });
        expect(repo.findVariantByKey).not.toHaveBeenCalled();
        expect(repo.transaction).not.toHaveBeenCalled();
        nothingWritten();
      });

      it('an unlocked variant is renamed under the lock protocol, in one transaction', async () => {
        await service.updateVariant('v1', { name: 'Max', colour: 'Blue' }, 'u1');
        expect(repo.lockVariantForIdentityChange).toHaveBeenCalledWith(CO, 'v1', TX);
        expect(repo.isVariantIdentityLocked).toHaveBeenLastCalledWith(CO, 'v1', TX);
        expect(repo.updateVariant).toHaveBeenCalledWith(CO, 'v1', { updatedById: 'u1', name: 'Max', colour: 'Blue' }, TX);
        expect(repo.lockVariantForIdentityChange.mock.invocationCallOrder[0]).toBeLessThan(repo.updateVariant.mock.invocationCallOrder[0]!);
      });

      it('a lock that appears before the lock protocol is caught under the lock (409, nothing written)', async () => {
        repo.isVariantIdentityLocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await expect(service.updateVariant('v1', { colour: 'Blue' }, 'u1')).rejects.toMatchObject({ status: 409, message: VARIANT_LOCKED });
        nothingWritten();
      });

      it('a locked variant keeps hex colour, list price, specifications, warranty months and active state editable', async () => {
        repo.isVariantIdentityLocked.mockResolvedValue(true);
        const editable = { hexColour: '#ff0000', exShowroomPrice: 13_000_000, batteryType: 'Li-ion', batteryCapacity: '3 kWh', rangeKm: 120, topSpeedKmph: 70, chargingTimeHrs: 4.5, motorPowerW: 2500, warrantyMonths: 36, name: 'Pro', colour: 'Red' };
        await service.updateVariant('v1', editable, 'u1');
        expect(repo.updateVariant).toHaveBeenCalledWith(CO, 'v1', expect.objectContaining({ hexColour: '#ff0000', exShowroomPrice: 13_000_000n, rangeKm: 120, warrantyMonths: 36 }));
        await service.setVariantActive('v1', false, 'u1');
        expect(repo.setVariantActive).toHaveBeenCalledWith(CO, 'v1', false, 'u1');
        expect(repo.isVariantIdentityLocked).not.toHaveBeenCalled();
        expect(repo.transaction).not.toHaveBeenCalled();
      });
    });

    it('a joining unit held elsewhere stops the rename with 409 "try again" (never a deadlock); nothing written', async () => {
      repo.lockVariantForIdentityChange.mockResolvedValue('BUSY');
      await expect(service.updateVariant('v1', { colour: 'Blue' }, 'u1')).rejects.toMatchObject({ status: 409, message: 'This catalogue entry is being changed elsewhere — try again.' });
      repo.lockModelForIdentityChange.mockResolvedValue('BUSY');
      await expect(service.updateModel('m1', { name: 'VX Pro' }, 'u1')).rejects.toMatchObject({ status: 409, message: 'This catalogue entry is being changed elsewhere — try again.' });
      expect(repo.isModelIdentityLocked).toHaveBeenCalledTimes(1); // the fast check only — no re-check after BUSY
      nothingWritten();
    });

    it('the read-only indicator rides on every catalogue DTO', async () => {
      repo.listModels.mockResolvedValue([model(), model({ id: 'm2', name: 'VY' })]);
      repo.countsByModel = jest.fn().mockResolvedValue(new Map());
      repo.lockedModelIds.mockResolvedValue(new Set(['m2']));
      const models = await service.listModelDtos({ status: 'all' });
      expect(models.map((m) => [m.id, m.identityLocked])).toEqual([['m1', false], ['m2', true]]);
      expect(repo.lockedModelIds).toHaveBeenCalledWith(CO);

      repo.listVariants.mockResolvedValue([variant(), variant({ id: 'v2', colour: 'Blue' })]);
      repo.unitCountsByVariant = jest.fn().mockResolvedValue(new Map());
      repo.lockedVariantIds.mockResolvedValue(new Set(['v1']));
      const variants = await service.listVariantDtos({ status: 'all' });
      expect(variants.map((v) => [v.id, v.identityLocked])).toEqual([['v1', true], ['v2', false]]);
      expect(repo.lockedVariantIds).toHaveBeenCalledWith(CO, ['v1', 'v2']);

      repo.isModelIdentityLocked.mockResolvedValue(true);
      expect((await service.modelDto(model())).identityLocked).toBe(true);
      repo.isVariantIdentityLocked.mockResolvedValue(false);
      expect((await service.variantDto(variant())).identityLocked).toBe(false);
    });
  });
});
