import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogService } from './catalog.service';
import type { CatalogRepository, ModelRow, VariantRow } from './catalog.repository';
import type { ActivityLogService } from '../../../activity-log/activity-log.service';
import type { TenantContext } from '../../../tenant/tenant-context.service';

const CO = 'company-a';
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
      await expect(service.createVariant({ modelId: 'other-co-model', name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
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
      await expect(service.createVariant({ modelId: 'm1', name: 'Pro', colour: 'Red', exShowroomPrice: 1 }, 'u1')).rejects.toBeInstanceOf(ConflictException);
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
      expect(log.record).toHaveBeenCalledWith({ actorId: 'u1', action: 'CREATE', entityType: 'ScooterModel', entityId: 'm1', summary: 'Created model TESTBRAND VX', metadata: { brand: 'TESTBRAND', name: 'VX', description: 'Flagship', isActive: true } });
    });

    it('14. model update records before/after for what changed, and nothing when nothing changed', async () => {
      repo.findModelById.mockResolvedValueOnce(model()).mockResolvedValueOnce(model({ name: 'VX Pro' }));
      await service.updateModel('m1', { name: 'VX Pro' }, 'u1');
      expect(repo.updateModel).toHaveBeenCalledWith(CO, 'm1', { updatedById: 'u1', name: 'VX Pro' });
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
      await service.createVariant({ modelId: 'm1', name: 'Pro', colour: 'Red', exShowroomPrice: 12_000_000, chargingTimeHrs: 4.5, rangeKm: 100 }, 'u1');
      expect(repo.createVariant).toHaveBeenCalledWith(CO, expect.objectContaining({ modelId: 'm1', name: 'Pro', colour: 'Red', exShowroomPrice: 12_000_000n, rangeKm: 100, chargingTimeHrs: new Prisma.Decimal(4.5), isActive: true, createdById: 'u1' }));
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityType: 'ScooterVariant', entityId: 'v1', summary: 'Created variant TESTBRAND VX Pro (Red)', metadata: expect.objectContaining({ exShowroomPrice: '12000000', colour: 'Red' }) }));
    });

    it('17. variant update records before/after', async () => {
      repo.findVariantById.mockResolvedValueOnce(variant()).mockResolvedValueOnce(variant({ exShowroomPrice: 12_500_000n, colour: 'Blue' }));
      await service.updateVariant('v1', { exShowroomPrice: 12_500_000, colour: 'Blue' }, 'u1');
      expect(repo.updateVariant).toHaveBeenCalledWith(CO, 'v1', { updatedById: 'u1', colour: 'Blue', exShowroomPrice: 12_500_000n });
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'ScooterVariant', metadata: { changes: { colour: { from: 'Red', to: 'Blue' }, exShowroomPrice: { from: '12000000', to: '12500000' } } } }));
    });

    it('18. variant deactivation records STATUS_CHANGE', async () => {
      repo.findVariantById.mockResolvedValueOnce(variant()).mockResolvedValueOnce(variant({ isActive: false }));
      await service.setVariantActive('v1', false, 'u1');
      expect(log.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'STATUS_CHANGE', entityType: 'ScooterVariant', summary: 'Deactivated variant TESTBRAND VX Pro (Red)' }));
    });
  });
});
