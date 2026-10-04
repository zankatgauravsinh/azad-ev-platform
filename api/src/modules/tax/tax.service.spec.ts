import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaxService } from './tax.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ActivityLogService } from '../../activity-log/activity-log.service';

const userId = 'u1';
const classRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1', companyId: 'co1', name: 'EV', codeType: 'HSN', code: '8711', treatment: 'TAXABLE',
  description: null, isActive: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  deletedAt: null, rates: [], ...over,
});
const rateRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1', companyId: 'co1', classificationId: 'c1', ratePercent: new Prisma.Decimal('5.00'),
  effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-06-30'), isActive: true,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});

describe('TaxService', () => {
  let prisma: {
    taxClassification: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    taxRate: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };
  let activityLog: { record: jest.Mock };
  let service: TaxService;

  beforeEach(() => {
    prisma = {
      taxClassification: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue(classRow()), update: jest.fn().mockResolvedValue(classRow()) },
      taxRate: { findFirst: jest.fn().mockResolvedValue(rateRow()), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(async ({ data }) => rateRow(data)), update: jest.fn().mockResolvedValue(rateRow()), delete: jest.fn().mockResolvedValue(rateRow()) },
    };
    activityLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new TaxService(prisma as unknown as PrismaService, activityLog as unknown as ActivityLogService);
  });

  describe('classifications', () => {
    it('creates when the name is free, and serialises the DTO', async () => {
      const dto = await service.createClassification({ name: 'EV', codeType: 'HSN', code: '8711', treatment: 'TAXABLE', isActive: true } as never, userId);
      expect(prisma.taxClassification.create).toHaveBeenCalled();
      expect(dto.code).toBe('8711');
      expect(dto.rates).toEqual([]);
    });

    it('rejects a duplicate name (409)', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(classRow());
      await expect(service.createClassification({ name: 'EV', codeType: 'HSN', code: '8711', treatment: 'TAXABLE' } as never, userId)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.taxClassification.create).not.toHaveBeenCalled();
    });

    it('blocks making a classification TAXABLE without a code', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(classRow({ treatment: 'EXEMPT', code: null }));
      await expect(service.updateClassification('c1', { treatment: 'TAXABLE' } as never, userId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for an unknown / cross-tenant id', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(null);
      await expect(service.getClassification('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rates — overlap & dates', () => {
    it('adds a rate when no active period overlaps', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(classRow());
      prisma.taxRate.findMany.mockResolvedValueOnce([rateRow({ effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2025-12-31') })]);
      const dto = await service.addRate('c1', { ratePercent: 5, effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-06-30'), isActive: true } as never, userId);
      expect(dto.ratePercent).toBe('5.00');
      expect(prisma.taxRate.create).toHaveBeenCalled();
    });

    it('rejects an overlapping active period (409)', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(classRow());
      prisma.taxRate.findMany.mockResolvedValueOnce([rateRow({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null })]); // open-ended
      await expect(service.addRate('c1', { ratePercent: 12, effectiveFrom: new Date('2026-07-01'), effectiveTo: null, isActive: true } as never, userId)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.taxRate.create).not.toHaveBeenCalled();
    });

    it('an inactive rate skips the overlap check', async () => {
      prisma.taxClassification.findFirst.mockResolvedValueOnce(classRow());
      prisma.taxRate.findMany.mockResolvedValueOnce([rateRow({ effectiveFrom: new Date('2026-01-01'), effectiveTo: null })]);
      await expect(service.addRate('c1', { ratePercent: 12, effectiveFrom: new Date('2026-02-01'), effectiveTo: null, isActive: false } as never, userId)).resolves.toBeDefined();
      expect(prisma.taxRate.findMany).not.toHaveBeenCalled();
    });

    it('rejects effectiveTo <= effectiveFrom on update (400)', async () => {
      prisma.taxRate.findFirst.mockResolvedValueOnce(rateRow());
      await expect(service.updateRate('r1', { effectiveFrom: new Date('2026-05-01'), effectiveTo: new Date('2026-01-01') } as never, userId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
