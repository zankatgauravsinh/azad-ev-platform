import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import type { InventoryRepository } from './inventory.repository';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { ExportService } from '../../export/export.service';
import type { StorageService } from '../../storage/storage.service';
import type { CatalogRepository } from './catalog/catalog.repository';
import type { TenantContext } from '../../tenant/tenant-context.service';

type RepoMock = jest.Mocked<
  Pick<
    InventoryRepository,
    | 'findByVin'
    | 'findByIdWithVariant'
    | 'findModelById'
    | 'findVariant'
    | 'createVariant'
    | 'createUnit'
    | 'updateUnit'
    | 'softDelete'
    | 'addEvent'
    | 'transaction'
  >
>;

const model = { id: 'model-1', name: 'VX1', brand: 'Comptech', modelId: 'model-1' };
const variant = {
  id: 'variant-1',
  name: 'Standard',
  colour: 'Teal',
  modelId: 'model-1',
  hexColour: null,
  exShowroomPrice: 10000n,
  model,
};
const unit = { id: 'unit-1', vin: 'VIN123', status: 'AVAILABLE', variant };

describe('InventoryService', () => {
  let repo: RepoMock;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let catalog: { findActiveVariantForUnit: jest.Mock };
  let service: InventoryService;
  const curated = { ...variant, id: 'variant-curated', colour: 'Red', exShowroomPrice: 12_500_000n, isActive: true };

  beforeEach(() => {
    repo = {
      findByVin: jest.fn(),
      findByIdWithVariant: jest.fn(),
      findModelById: jest.fn().mockResolvedValue(model),
      findVariant: jest.fn(),
      createVariant: jest.fn().mockResolvedValue(variant),
      createUnit: jest.fn().mockResolvedValue(unit),
      updateUnit: jest.fn().mockResolvedValue({ ...unit, status: 'RESERVED' }),
      softDelete: jest.fn().mockResolvedValue(unit),
      addEvent: jest.fn().mockResolvedValue({}),
      // run the callback immediately with a dummy tx client
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
    } as never;
    activityLog = { record: jest.fn().mockResolvedValue(undefined) } as never;
    catalog = { findActiveVariantForUnit: jest.fn().mockResolvedValue({ variant: curated }) };

    service = new InventoryService(
      repo as unknown as InventoryRepository,
      activityLog as unknown as ActivityLogService,
      {} as ExportService,
      {} as StorageService,
      catalog as unknown as CatalogRepository,
      { requireCompanyId: () => 'company-1' } as unknown as TenantContext,
    );
  });

  describe('create', () => {
    const dto = {
      modelId: 'model-1',
      variant: 'Standard',
      colour: 'Teal',
      vin: 'VIN123',
      motorNumber: 'M1',
      batteryNumber: 'B1',
      purchaseCost: 100,
      sellingPrice: 200,
      status: 'AVAILABLE' as const,
    };

    it('rejects a duplicate VIN before creating', async () => {
      repo.findByVin.mockResolvedValue(unit as never);
      await expect(service.create(dto, 'user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createUnit).not.toHaveBeenCalled();
    });

    it('creates the unit and records a genesis "Purchased" event', async () => {
      repo.findByVin.mockResolvedValue(null);
      repo.findVariant.mockResolvedValue(null);

      const result = await service.create(dto, 'user-1');

      expect(result).toBe(unit);
      expect(repo.createUnit).toHaveBeenCalledTimes(1);
      expect(repo.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: null, toStatus: 'AVAILABLE' }),
        expect.anything(),
      );
      expect(activityLog.record).toHaveBeenCalled();
    });
  });

  describe('create with a curated variant (M4A)', () => {
    const base = { vin: 'VIN9', motorNumber: 'M9', batteryNumber: 'B9', purchaseCost: 100, status: 'AVAILABLE' as const };
    beforeEach(() => { repo.findByVin.mockResolvedValue(null); });

    it('resolves the variant through the catalogue, scoped to the company, and creates no variant', async () => {
      await service.create({ ...base, variantId: 'variant-curated', sellingPrice: 11_000_000 }, 'user-1');
      expect(catalog.findActiveVariantForUnit).toHaveBeenCalledWith('company-1', 'variant-curated');
      expect(repo.findModelById).not.toHaveBeenCalled();
      expect(repo.findVariant).not.toHaveBeenCalled();
      expect(repo.createVariant).not.toHaveBeenCalled();
      expect(repo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ variant: { connect: { id: 'variant-curated' } }, sellingPrice: 11_000_000n }), expect.anything());
    });

    it('variantId wins over free-text fields sent alongside it', async () => {
      await service.create({ ...base, variantId: 'variant-curated', modelId: 'model-1', variant: 'Ghost', colour: 'Purple', sellingPrice: 1 }, 'user-1');
      expect(repo.createVariant).not.toHaveBeenCalled();
      expect(repo.findVariant).not.toHaveBeenCalled();
      expect(repo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ variant: { connect: { id: 'variant-curated' } } }), expect.anything());
    });

    it('selling price omitted → the variant list price is the initial unit price (curated) or 0 (legacy)', async () => {
      await service.create({ ...base, variantId: 'variant-curated' }, 'user-1');
      expect(repo.createUnit).toHaveBeenLastCalledWith(expect.objectContaining({ sellingPrice: 12_500_000n }), expect.anything());
      repo.findVariant.mockResolvedValue(variant as never);
      await service.create({ ...base, modelId: 'model-1', variant: 'Standard', colour: 'Teal' }, 'user-1');
      expect(repo.createUnit).toHaveBeenLastCalledWith(expect.objectContaining({ sellingPrice: 0n }), expect.anything());
    });

    it("another company's variant → 404; inactive variant / model → 409; nothing written", async () => {
      catalog.findActiveVariantForUnit.mockResolvedValueOnce({ error: 'NOT_FOUND' });
      await expect(service.create({ ...base, variantId: 'other' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      catalog.findActiveVariantForUnit.mockResolvedValueOnce({ error: 'VARIANT_INACTIVE' });
      await expect(service.create({ ...base, variantId: 'old' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
      catalog.findActiveVariantForUnit.mockResolvedValueOnce({ error: 'MODEL_INACTIVE' });
      await expect(service.create({ ...base, variantId: 'older' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createUnit).not.toHaveBeenCalled();
    });

    it('legacy shape without a complete model / variant / colour is a 400', async () => {
      await expect(service.create({ ...base, modelId: 'model-1', variant: 'Standard' }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createUnit).not.toHaveBeenCalled();
    });
  });

  describe('update with a curated variant (M4A)', () => {
    beforeEach(() => { repo.findByIdWithVariant.mockResolvedValue(unit as never); });

    it('re-points to the curated variant; free-text fields alongside are ignored; no variant created', async () => {
      await service.update('unit-1', { variantId: 'variant-curated', modelId: 'model-1', variant: 'Ghost', colour: 'Purple' }, 'user-1');
      expect(catalog.findActiveVariantForUnit).toHaveBeenCalledWith('company-1', 'variant-curated');
      expect(repo.createVariant).not.toHaveBeenCalled();
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ variant: { connect: { id: 'variant-curated' } } }), expect.anything());
    });

    it('legacy free-text update still resolves (and may create) by text', async () => {
      repo.findVariant.mockResolvedValue(null);
      await service.update('unit-1', { colour: 'Lime' }, 'user-1');
      expect(catalog.findActiveVariantForUnit).not.toHaveBeenCalled();
      expect(repo.createVariant).toHaveBeenCalledTimes(1);
    });

    it("another company's variant → 404 and the unit is not written", async () => {
      catalog.findActiveVariantForUnit.mockResolvedValueOnce({ error: 'NOT_FOUND' });
      await expect(service.update('unit-1', { variantId: 'other' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateUnit).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    it('rejects an illegal transition', async () => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status: 'AVAILABLE' } as never);
      await expect(
        service.changeStatus('unit-1', { toStatus: 'DELIVERED' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.updateUnit).not.toHaveBeenCalled();
    });

    it('rejects a no-op transition to the same status', async () => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status: 'AVAILABLE' } as never);
      await expect(
        service.changeStatus('unit-1', { toStatus: 'AVAILABLE' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('applies a legal transition and appends a history event', async () => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status: 'AVAILABLE' } as never);
      const result = await service.changeStatus(
        'unit-1',
        { toStatus: 'RESERVED', note: 'hold' },
        'user-1',
      );
      expect(result.status).toBe('RESERVED');
      expect(repo.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: 'AVAILABLE', toStatus: 'RESERVED', note: 'hold' }),
        expect.anything(),
      );
    });
  });

  describe('remove', () => {
    it('blocks deleting a BOOKED unit', async () => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status: 'BOOKED' } as never);
      await expect(service.remove('unit-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes an AVAILABLE unit', async () => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status: 'AVAILABLE' } as never);
      await service.remove('unit-1', 'user-1');
      expect(repo.softDelete).toHaveBeenCalledWith('unit-1');
    });
  });

  describe('checkVin', () => {
    it('reports existence and normalises case', async () => {
      repo.findByVin.mockResolvedValue(unit as never);
      const res = await service.checkVin(' vin123 ');
      expect(repo.findByVin).toHaveBeenCalledWith('VIN123');
      expect(res).toEqual({ exists: true });
    });
  });
});
