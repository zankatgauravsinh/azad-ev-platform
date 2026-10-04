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

    it('rejects effectiveTo before effectiveFrom on update (400)', async () => {
      prisma.taxRate.findFirst.mockResolvedValueOnce(rateRow());
      await expect(service.updateRate('r1', { effectiveFrom: new Date('2026-05-01'), effectiveTo: new Date('2026-01-01') } as never, userId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // Effective dates are CALENDAR DATES, inclusive on both ends (Stage A date-semantics correction).
  describe('rates — calendar-date semantics (inclusive from / inclusive to)', () => {
    const existing = (from: string, to: string | null): Record<string, unknown> =>
      rateRow({ id: 'existing', effectiveFrom: new Date(`${from}T00:00:00.000Z`), effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null });
    const add = (from: string, to: string | null) =>
      service.addRate('c1', { ratePercent: 12, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null, isActive: true } as never, userId);
    beforeEach(() => prisma.taxClassification.findFirst.mockResolvedValue(classRow()));

    it('accepts adjacent ranges: …→2026-06-30 then 2026-07-01→open (no gap, no overlap)', async () => {
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-06-30')]);
      await expect(add('2026-07-01', null)).resolves.toBeDefined();
    });

    it('rejects a range starting on the last day of another (the shared boundary day overlaps)', async () => {
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-06-30')]);
      await expect(add('2026-06-30', null)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a range ending on the first day of another', async () => {
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-07-01', null)]);
      await expect(add('2026-01-01', '2026-07-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a range ending the day before an open-ended one starts', async () => {
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-07-01', null)]);
      await expect(add('2026-01-01', '2026-06-30')).resolves.toBeDefined();
    });

    it('rejects a second open-ended range and a contained range', async () => {
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', null)]);
      await expect(add('2030-01-01', null)).rejects.toBeInstanceOf(ConflictException);
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-12-31')]);
      await expect(add('2026-03-01', '2026-04-30')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows a single-day rate (effectiveFrom === effectiveTo)', async () => {
      await expect(add('2026-06-30', '2026-06-30')).resolves.toBeDefined();
    });

    it('ignores time-of-day: stores 00:00 UTC of the calendar date and compares by date', async () => {
      // Existing rate ends 30 Jun; a new one "starting" late on 30 Jun still shares that calendar day.
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-06-30')]);
      await expect(add('2026-06-30T18:45:00.000Z', null)).rejects.toBeInstanceOf(ConflictException);

      await add('2026-07-01T09:30:00.000Z', '2026-12-31T23:00:00.000Z');
      const data = prisma.taxRate.create.mock.calls.at(-1)![0].data as { effectiveFrom: Date; effectiveTo: Date };
      expect(data.effectiveFrom.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(data.effectiveTo.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('update: moving a range onto another’s boundary day is rejected; adjacent is accepted', async () => {
      prisma.taxRate.findFirst.mockResolvedValue(rateRow({ id: 'r2', effectiveFrom: new Date('2026-07-01T00:00:00.000Z'), effectiveTo: null }));
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-06-30')]);
      await expect(service.updateRate('r2', { effectiveFrom: new Date('2026-06-30') } as never, userId)).rejects.toBeInstanceOf(ConflictException);
      prisma.taxRate.findMany.mockResolvedValueOnce([existing('2026-01-01', '2026-06-30')]);
      await expect(service.updateRate('r2', { effectiveFrom: new Date('2026-07-01') } as never, userId)).resolves.toBeDefined();
    });
  });
});
