import { BadRequestException, ConflictException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import type { InventoryRepository } from './inventory.repository';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { ExportService } from '../../export/export.service';
import type { StorageService } from '../../storage/storage.service';

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
  let service: InventoryService;

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

    service = new InventoryService(
      repo as unknown as InventoryRepository,
      activityLog as unknown as ActivityLogService,
      {} as ExportService,
      {} as StorageService,
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
