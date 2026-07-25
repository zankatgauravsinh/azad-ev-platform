import { BadRequestException, ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { CustomersRepository } from './customers.repository';
import type { CustomerTimelineService } from './customer-timeline.service';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { StorageService } from '../../storage/storage.service';

const customer = { id: 'c1', name: 'Ramesh', phone: '9825012345', leadStatus: 'NEW' };

describe('CustomersService', () => {
  let repo: jest.Mocked<
    Pick<CustomersRepository, 'findByPhone' | 'create' | 'update' | 'findById' | 'softDelete'>
  >;
  let timeline: jest.Mocked<Pick<CustomerTimelineService, 'record'>>;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let service: CustomersService;

  beforeEach(() => {
    repo = {
      findByPhone: jest.fn(),
      create: jest.fn().mockResolvedValue(customer),
      update: jest.fn().mockResolvedValue({ ...customer, leadStatus: 'INTERESTED' }),
      findById: jest.fn().mockResolvedValue(customer),
      softDelete: jest.fn().mockResolvedValue(customer),
    } as never;
    timeline = { record: jest.fn().mockResolvedValue({}) } as never;
    activityLog = { record: jest.fn().mockResolvedValue(undefined) } as never;

    service = new CustomersService(
      repo as unknown as CustomersRepository,
      timeline as unknown as CustomerTimelineService,
      activityLog as unknown as ActivityLogService,
      {} as StorageService,
    );
  });

  describe('create', () => {
    const dto = { name: 'Ramesh', phone: '9825012345', leadStatus: 'NEW' as const };

    it('rejects a duplicate mobile number', async () => {
      repo.findByPhone.mockResolvedValue(customer as never);
      await expect(service.create(dto, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates a customer and records a LEAD_CREATED timeline entry', async () => {
      repo.findByPhone.mockResolvedValue(null);
      const result = await service.create(dto, 'u1');
      expect(result).toBe(customer);
      expect(timeline.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LEAD_CREATED', customerId: 'c1' }),
      );
      expect(activityLog.record).toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    it('rejects a no-op status change', async () => {
      repo.findById.mockResolvedValue({ ...customer, leadStatus: 'NEW' } as never);
      await expect(service.changeStatus('c1', { leadStatus: 'NEW' }, 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('changes status and records a STATUS_CHANGED timeline entry', async () => {
      repo.findById.mockResolvedValue({ ...customer, leadStatus: 'NEW' } as never);
      await service.changeStatus('c1', { leadStatus: 'INTERESTED' }, 'u1');
      expect(repo.update).toHaveBeenCalledWith('c1', expect.objectContaining({ leadStatus: 'INTERESTED' }));
      expect(timeline.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'STATUS_CHANGED' }),
      );
    });

    it('stores the lost reason when marking a lead Lost', async () => {
      repo.findById.mockResolvedValue({ ...customer, leadStatus: 'NEGOTIATION' } as never);
      await service.changeStatus('c1', { leadStatus: 'LOST', lostReason: 'Bought elsewhere' }, 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ leadStatus: 'LOST', lostReason: 'Bought elsewhere' }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes a customer', async () => {
      await service.remove('c1', 'u1');
      expect(repo.softDelete).toHaveBeenCalledWith('c1');
    });
  });
});
