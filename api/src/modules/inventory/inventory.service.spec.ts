import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { identificationCorrectionSchema } from '@azad/shared';
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
    | 'lockUnit'
    | 'hasCommittedHistory'
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
const unit = { id: 'unit-1', vin: 'VIN123', status: 'AVAILABLE', variantId: 'variant-1', variant };

const NOT_ELIGIBLE = 'Identification correction applies only to delivered, in-service or returned vehicles, or to vehicles with a sale, warranty or AMC history — edit this vehicle instead.';
const HISTORY_IDENTIFICATION = 'Vehicle identification cannot be changed once the vehicle has a sale, warranty or AMC history — use the owner identification correction.';
const HISTORY_VARIANT = 'Vehicle model/variant cannot be changed once the vehicle has a sale, warranty or AMC history.';
const CHANGED = 'This vehicle was changed by someone else — reload and try again.';

describe('InventoryService', () => {
  let repo: RepoMock;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record' | 'recordInTransaction'>>;
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
      // By default the locked row is the unit as read, and the vehicle has no committed history.
      lockUnit: jest.fn(() => repo.findByIdWithVariant('unit-1')),
      hasCommittedHistory: jest.fn().mockResolvedValue(false),
    } as never;
    activityLog = { record: jest.fn().mockResolvedValue(undefined), recordInTransaction: jest.fn().mockResolvedValue(undefined) } as never;
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

  describe('variant identity guard (M4B)', () => {
    const other = { ...variant, id: 'variant-2', colour: 'Red' };
    const at = (status: string) => { repo.findByIdWithVariant.mockResolvedValue({ ...unit, status, variantId: 'variant-1' } as never); };

    it.each(['AVAILABLE', 'RESERVED'])('%s: a curated change and a legacy change are allowed and audited old → new', async (status) => {
      at(status);
      catalog.findActiveVariantForUnit.mockResolvedValue({ variant: other });
      await service.update('unit-1', { variantId: 'variant-2' }, 'user-1');
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ variant: { connect: { id: 'variant-2' } } }), expect.anything());
      expect(activityLog.record).toHaveBeenLastCalledWith(expect.objectContaining({
        summary: 'Updated scooter VIN123: variant Comptech VX1 Standard (Teal) → Comptech VX1 Standard (Red)',
        metadata: { variantChange: { from: expect.objectContaining({ variantId: 'variant-1', colour: 'Teal' }), to: expect.objectContaining({ variantId: 'variant-2', colour: 'Red' }) } },
      }));
      repo.findVariant.mockResolvedValue(other as never);
      await service.update('unit-1', { colour: 'Red' }, 'user-1');
      expect(repo.updateUnit).toHaveBeenLastCalledWith('unit-1', expect.objectContaining({ variant: { connect: { id: 'variant-2' } } }), expect.anything());
    });

    it.each(['BOOKED', 'DELIVERED', 'IN_SERVICE', 'RETURNED'])('%s: a curated change and a legacy change are refused with 409 and nothing is written', async (status) => {
      at(status);
      catalog.findActiveVariantForUnit.mockResolvedValue({ variant: other });
      await expect(service.update('unit-1', { variantId: 'variant-2', notes: 'x', sellingPrice: 5, location: 'Yard' }, 'user-1')).rejects.toMatchObject({ status: 409, message: 'Vehicle model/variant cannot be changed after booking or delivery.' });
      repo.findVariant.mockResolvedValue(other as never);
      await expect(service.update('unit-1', { colour: 'Red', location: 'Yard B' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
      repo.findVariant.mockResolvedValue(null); // a brand-new combination would be created by the legacy resolver…
      repo.createVariant.mockResolvedValue({ ...other, id: 'variant-new', modelId: 'model-2' } as never);
      await expect(service.update('unit-1', { modelId: 'model-2', variant: 'Standard', colour: 'Teal' }, 'user-1')).rejects.toBeInstanceOf(ConflictException); // …and still refused (rolled back)
      expect(repo.updateUnit).not.toHaveBeenCalled();
      expect(activityLog.record).not.toHaveBeenCalled();
    });

    it.each(['BOOKED', 'DELIVERED'])('%s: naming the CURRENT variant (by id or by the same model / variant / colour) is not a change', async (status) => {
      at(status);
      catalog.findActiveVariantForUnit.mockResolvedValue({ variant: variant });
      await service.update('unit-1', { variantId: 'variant-1', notes: 'serviced' }, 'user-1');
      repo.findVariant.mockResolvedValue(variant as never);
      await service.update('unit-1', { modelId: 'model-1', variant: 'Standard', colour: 'Teal', location: 'Bay 2' }, 'user-1');
      expect(repo.updateUnit).toHaveBeenCalledTimes(2);
      for (const call of repo.updateUnit.mock.calls) expect(call[1]).not.toHaveProperty('variant');
      expect(activityLog.record).toHaveBeenCalledTimes(2);
      for (const call of activityLog.record.mock.calls) expect(call[0]).toMatchObject({ summary: 'Updated scooter VIN123' });
      for (const call of activityLog.record.mock.calls) expect(call[0]).not.toHaveProperty('metadata');
    });

    it('non-identity edits on a committed unit keep working', async () => {
      at('DELIVERED');
      await service.update('unit-1', { location: 'Customer', notes: 'Delivered', sellingPrice: 1 }, 'user-1');
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ location: 'Customer', notes: 'Delivered', sellingPrice: 1n }), expect.anything());
      expect(catalog.findActiveVariantForUnit).not.toHaveBeenCalled();
    });

    it("a cross-tenant variantId is a 404 before the status rule, even on a committed unit", async () => {
      at('DELIVERED');
      catalog.findActiveVariantForUnit.mockResolvedValue({ error: 'NOT_FOUND' });
      await expect(service.update('unit-1', { variantId: 'theirs' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateUnit).not.toHaveBeenCalled();
    });
  });

  describe('identification guard (M4B.2)', () => {
    const at = (status: string) => { repo.findByIdWithVariant.mockResolvedValue({ ...unit, status, variantId: 'variant-1', motorNumber: 'M1', batteryNumber: 'B1' } as never); };
    beforeEach(() => { repo.findByVin.mockResolvedValue(null); });

    it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s: VIN, motor and battery may change and each change is audited with from/to', async (status) => {
      at(status);
      await service.update('unit-1', { vin: 'NEWVIN', motorNumber: 'M2', batteryNumber: 'B2', notes: 'n' }, 'user-1');
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ vin: 'NEWVIN', motorNumber: 'M2', batteryNumber: 'B2' }), expect.anything());
      expect(activityLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE',
        summary: 'Updated scooter VIN123: vin VIN123 → NEWVIN; motorNumber M1 → M2; batteryNumber B1 → B2',
        metadata: { identificationChanges: [{ field: 'vin', from: 'VIN123', to: 'NEWVIN' }, { field: 'motorNumber', from: 'M1', to: 'M2' }, { field: 'batteryNumber', from: 'B1', to: 'B2' }] },
      }));
    });

    it.each([
      ['DELIVERED', { vin: 'NEWVIN' }], ['DELIVERED', { motorNumber: 'M2' }], ['DELIVERED', { batteryNumber: 'B2' }],
      ['IN_SERVICE', { vin: 'NEWVIN', motorNumber: 'M2' }], ['RETURNED', { motorNumber: 'M2', batteryNumber: 'B2' }], ['DELIVERED', { vin: 'NEWVIN', motorNumber: 'M2', batteryNumber: 'B2' }],
    ])('%s: %o is refused with 409, nothing written, no audit, no VIN pre-check', async (status, change) => {
      at(status);
      await expect(service.update('unit-1', { ...change, sellingPrice: 5, notes: 'tampered' }, 'user-1')).rejects.toMatchObject({ status: 409, message: 'Vehicle identification cannot be changed after delivery.' });
      expect(repo.updateUnit).not.toHaveBeenCalled();
      expect(repo.findByVin).not.toHaveBeenCalled();
      expect(activityLog.record).not.toHaveBeenCalled();
    });

    it.each(['DELIVERED', 'IN_SERVICE', 'RETURNED'])('%s: the same values (already upper-cased by the schema) are not a change; other fields still update; no identificationChanges', async (status) => {
      at(status);
      await service.update('unit-1', { vin: 'VIN123', motorNumber: 'M1', batteryNumber: 'B1', location: 'Bay 3' }, 'user-1');
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ location: 'Bay 3' }), expect.anything());
      expect(activityLog.record).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Updated scooter VIN123' }));
      expect(activityLog.record.mock.calls[0]![0]).not.toHaveProperty('metadata');
    });

    it('one changed field → one entry; a variant change in the same allowed request shares the entry', async () => {
      at('AVAILABLE');
      catalog.findActiveVariantForUnit.mockResolvedValue({ variant: { ...variant, id: 'variant-2', colour: 'Red' } });
      await service.update('unit-1', { motorNumber: 'M2', variantId: 'variant-2' }, 'user-1');
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const entry = activityLog.record.mock.calls[0]![0] as unknown as { metadata: { variantChange: unknown; identificationChanges: unknown[] }; summary: string };
      expect(entry.metadata.identificationChanges).toEqual([{ field: 'motorNumber', from: 'M1', to: 'M2' }]);
      expect(entry.metadata.variantChange).toMatchObject({ to: { variantId: 'variant-2' } });
      expect(entry.summary).toBe('Updated scooter VIN123: variant Comptech VX1 Standard (Teal) → Comptech VX1 Standard (Red); motorNumber M1 → M2');
    });

    it('VIN uniqueness pre-check still runs for an allowed VIN change', async () => {
      at('BOOKED');
      repo.findByVin.mockResolvedValue({ id: 'other' } as never);
      await expect(service.update('unit-1', { vin: 'TAKEN' }, 'user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateUnit).not.toHaveBeenCalled();
    });
  });

  describe('identification correction (M4B.3)', () => {
    const OWNER = { id: 'owner-1', role: 'OWNER' as const };
    const TX = { tx: true };
    const at = (status: string) => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status, motorNumber: 'M1', batteryNumber: 'B1' } as never);
    };
    const correction = (over: Record<string, unknown>) => ({ reason: 'Typo at stock entry', ...over }) as never;
    const nothingWritten = () => {
      expect(repo.updateUnit).not.toHaveBeenCalled();
      expect(activityLog.recordInTransaction).not.toHaveBeenCalled();
      expect(activityLog.record).not.toHaveBeenCalled();
    };
    beforeEach(() => {
      repo.findByVin.mockResolvedValue(null);
      repo.transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(TX)) as never);
      repo.updateUnit.mockImplementation(((_id: string, data: object) => Promise.resolve({ ...unit, ...data })) as never);
    });

    it.each([
      ['DELIVERED', { vin: 'NEWVIN' }, [{ field: 'vin', from: 'VIN123', to: 'NEWVIN' }]],
      ['IN_SERVICE', { motorNumber: 'M2' }, [{ field: 'motorNumber', from: 'M1', to: 'M2' }]],
      ['RETURNED', { batteryNumber: 'B2' }, [{ field: 'batteryNumber', from: 'B1', to: 'B2' }]],
      ['DELIVERED', { vin: 'NEWVIN', motorNumber: 'M2', batteryNumber: 'B2' }, [
        { field: 'vin', from: 'VIN123', to: 'NEWVIN' }, { field: 'motorNumber', from: 'M1', to: 'M2' }, { field: 'batteryNumber', from: 'B1', to: 'B2' },
      ]],
    ])('%s: owner corrects %o — only those fields are written, with one audit entry in the same transaction', async (status, change, changes) => {
      at(status);
      const result = await service.correctIdentification('unit-1', correction(change), OWNER);
      expect(repo.updateUnit).toHaveBeenCalledTimes(1);
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', { updatedById: 'owner-1', ...change }, TX);
      expect(result).toMatchObject(change);
      expect(activityLog.recordInTransaction).toHaveBeenCalledTimes(1);
      expect(activityLog.recordInTransaction).toHaveBeenCalledWith({
        actorId: 'owner-1',
        action: 'UPDATE',
        entityType: 'InventoryUnit',
        entityId: 'unit-1',
        summary: `Updated scooter VIN123: ${changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join('; ')} (identification correction)`,
        metadata: { identificationCorrection: { reason: 'Typo at stock entry', changes } },
      }, TX);
      expect(activityLog.record).not.toHaveBeenCalled();
    });

    it.each(['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'])('%s is refused (403) before the unit is even read', async (role) => {
      at('DELIVERED');
      await expect(service.correctIdentification('unit-1', correction({ vin: 'NEWVIN' }), { id: 'u', role: role as never })).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findByIdWithVariant).not.toHaveBeenCalled();
      nothingWritten();
    });

    it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s without committed history is refused (409): the ordinary edit is the path', async (status) => {
      at(status);
      await expect(service.correctIdentification('unit-1', correction({ vin: 'NEWVIN' }), OWNER)).rejects.toMatchObject({
        status: 409, message: NOT_ELIGIBLE,
      });
      nothingWritten();
    });

    it('an unknown unit is a 404', async () => {
      repo.findByIdWithVariant.mockResolvedValue(null);
      await expect(service.correctIdentification('nope', correction({ vin: 'NEWVIN' }), OWNER)).rejects.toBeInstanceOf(NotFoundException);
      nothingWritten();
    });

    it('same values only (the schema has already upper-cased them) → 400, nothing written, no VIN check', async () => {
      at('DELIVERED');
      await expect(service.correctIdentification('unit-1', correction({ vin: 'VIN123', motorNumber: 'M1', batteryNumber: 'B1' }), OWNER)).rejects.toMatchObject({
        status: 400, message: 'Nothing to correct: the identification given matches the vehicle.',
      });
      expect(repo.findByVin).not.toHaveBeenCalled();
      nothingWritten();
    });

    it('a same value sent alongside a real change is not part of the correction', async () => {
      at('IN_SERVICE');
      await service.correctIdentification('unit-1', correction({ vin: 'VIN123', batteryNumber: 'B9' }), OWNER);
      expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', { updatedById: 'owner-1', batteryNumber: 'B9' }, TX);
      expect(repo.findByVin).not.toHaveBeenCalled();
      const entry = activityLog.recordInTransaction.mock.calls[0]![0] as unknown as { metadata: { identificationCorrection: { changes: unknown[] } } };
      expect(entry.metadata.identificationCorrection.changes).toEqual([{ field: 'batteryNumber', from: 'B1', to: 'B9' }]);
    });

    it('VIN already used → 409 from the existing pre-check; nothing written, even with a motor change alongside', async () => {
      at('DELIVERED');
      repo.findByVin.mockResolvedValue({ id: 'other' } as never);
      await expect(service.correctIdentification('unit-1', correction({ vin: 'TAKEN', motorNumber: 'M2' }), OWNER)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.findByVin).toHaveBeenCalledWith('TAKEN');
      nothingWritten();
    });

    it('a database uniqueness failure (motor / battery) aborts the transaction before any audit entry', async () => {
      at('RETURNED');
      const clash = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      repo.updateUnit.mockRejectedValue(clash);
      await expect(service.correctIdentification('unit-1', correction({ motorNumber: 'TAKEN' }), OWNER)).rejects.toBe(clash);
      expect(activityLog.recordInTransaction).not.toHaveBeenCalled();
      expect(activityLog.record).not.toHaveBeenCalled();
    });

    it('if the audit entry cannot be written the correction fails with it (same transaction)', async () => {
      at('DELIVERED');
      activityLog.recordInTransaction.mockRejectedValue(new Error('audit down'));
      await expect(service.correctIdentification('unit-1', correction({ vin: 'NEWVIN' }), OWNER)).rejects.toThrow('audit down');
    });

    it('the ordinary edit keeps refusing identification changes after delivery (M4B.2 unchanged)', async () => {
      at('DELIVERED');
      await expect(service.update('unit-1', { vin: 'NEWVIN' }, 'owner-1')).rejects.toMatchObject({ status: 409, message: 'Vehicle identification cannot be changed after delivery.' });
      nothingWritten();
    });
  });

  describe('historical commitment (M4B.4)', () => {
    const TX = { tx: true };
    const OWNER = { id: 'owner-1', role: 'OWNER' as const };
    const at = (status: string, committed: boolean) => {
      repo.findByIdWithVariant.mockResolvedValue({ ...unit, status, motorNumber: 'M1', batteryNumber: 'B1' } as never);
      repo.hasCommittedHistory.mockResolvedValue(committed);
    };
    const nothingWritten = () => {
      expect(repo.updateUnit).not.toHaveBeenCalled();
      expect(activityLog.record).not.toHaveBeenCalled();
      expect(activityLog.recordInTransaction).not.toHaveBeenCalled();
    };
    beforeEach(() => {
      repo.findByVin.mockResolvedValue(null);
      repo.transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(TX)) as never);
    });

    describe('ordinary edit', () => {
      it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s with history: VIN / motor / battery changes are refused (409) before anything else, nothing written', async (status) => {
        at(status, true);
        await expect(service.update('unit-1', { vin: 'NEWVIN', motorNumber: 'M2', notes: 'x' }, 'user-1')).rejects.toMatchObject({ status: 409, message: HISTORY_IDENTIFICATION });
        expect(repo.hasCommittedHistory).toHaveBeenCalledWith('unit-1');
        expect(repo.findByVin).not.toHaveBeenCalled();
        nothingWritten();
      });

      it.each(['AVAILABLE', 'RESERVED'])('%s with history: a variant change is refused (409), nothing written', async (status) => {
        at(status, true);
        catalog.findActiveVariantForUnit.mockResolvedValue({ variant: { ...variant, id: 'variant-2', colour: 'Red' } });
        await expect(service.update('unit-1', { variantId: 'variant-2' }, 'user-1')).rejects.toMatchObject({ status: 409, message: HISTORY_VARIANT });
        expect(repo.lockUnit).toHaveBeenCalledWith('company-1', 'unit-1', TX);
        expect(repo.hasCommittedHistory).toHaveBeenCalledWith('unit-1', TX);
        nothingWritten();
      });

      it('a legacy free-text variant change on a committed unit is refused too (and any variant it created rolls back)', async () => {
        at('AVAILABLE', true);
        repo.findVariant.mockResolvedValue(null);
        repo.createVariant.mockResolvedValue({ ...variant, id: 'variant-lime', colour: 'Lime' } as never);
        await expect(service.update('unit-1', { variant: 'Standard', colour: 'Lime' }, 'user-1')).rejects.toMatchObject({ status: 409, message: HISTORY_VARIANT });
        nothingWritten();
      });

      it('the status rules come first: a delivered unit gets the M4B.2 message without a history query', async () => {
        at('DELIVERED', true);
        await expect(service.update('unit-1', { vin: 'NEWVIN' }, 'user-1')).rejects.toMatchObject({ status: 409, message: 'Vehicle identification cannot be changed after delivery.' });
        expect(repo.hasCommittedHistory).not.toHaveBeenCalled();
        nothingWritten();
      });

      it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s without history: identifier changes still work (M4B.2), checked again under the row lock', async (status) => {
        at(status, false);
        await service.update('unit-1', { vin: 'NEWVIN' }, 'user-1');
        expect(repo.lockUnit).toHaveBeenCalledWith('company-1', 'unit-1', TX);
        expect(repo.hasCommittedHistory).toHaveBeenNthCalledWith(1, 'unit-1');
        expect(repo.hasCommittedHistory).toHaveBeenNthCalledWith(2, 'unit-1', TX);
        expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ vin: 'NEWVIN' }), TX);
      });

      it('history that appears after the first check (an invoice committed meanwhile) is caught under the lock', async () => {
        at('BOOKED', false);
        repo.hasCommittedHistory.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await expect(service.update('unit-1', { batteryNumber: 'B2' }, 'user-1')).rejects.toMatchObject({ status: 409, message: HISTORY_IDENTIFICATION });
        nothingWritten();
      });

      it('a status that moved on before the lock is caught under the lock (M4B.2 message)', async () => {
        at('BOOKED', false);
        repo.lockUnit.mockResolvedValue({ ...unit, status: 'DELIVERED', motorNumber: 'M1', batteryNumber: 'B1' } as never);
        await expect(service.update('unit-1', { motorNumber: 'M2' }, 'user-1')).rejects.toMatchObject({ status: 409, message: 'Vehicle identification cannot be changed after delivery.' });
        nothingWritten();
      });

      it('an identity changed by someone else before the lock stops the request (409, reload)', async () => {
        at('AVAILABLE', false);
        repo.lockUnit.mockResolvedValue({ ...unit, vin: 'OTHERVIN', motorNumber: 'M1', batteryNumber: 'B1' } as never);
        await expect(service.update('unit-1', { motorNumber: 'M2' }, 'user-1')).rejects.toMatchObject({ status: 409, message: CHANGED });
        nothingWritten();
      });

      it('non-identity edits on a committed unit are unchanged: no lock, no history query', async () => {
        at('AVAILABLE', true);
        await service.update('unit-1', { notes: 'n', location: 'Bay 4', supplier: 'S', sellingPrice: 123, purchaseCost: 100 }, 'user-1');
        expect(repo.lockUnit).not.toHaveBeenCalled();
        expect(repo.hasCommittedHistory).not.toHaveBeenCalled();
        expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', expect.objectContaining({ notes: 'n', location: 'Bay 4', supplier: 'S', sellingPrice: 123n, purchaseCost: 100n }), TX);
      });

      it('sending the current identity values on a committed unit is not a change and is allowed', async () => {
        at('AVAILABLE', true);
        catalog.findActiveVariantForUnit.mockResolvedValue({ variant });
        await service.update('unit-1', { vin: 'VIN123', motorNumber: 'M1', batteryNumber: 'B1', variantId: 'variant-1', location: 'Bay 5' }, 'user-1');
        expect(repo.hasCommittedHistory).not.toHaveBeenCalled();
        expect(repo.updateUnit).toHaveBeenCalledTimes(1);
      });
    });

    describe('owner correction', () => {
      it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s with history: eligible; checked again under the lock; one audit entry', async (status) => {
        at(status, true);
        await service.correctIdentification('unit-1', { vin: 'NEWVIN', reason: 'Typo at stock entry' } as never, OWNER);
        expect(repo.hasCommittedHistory).toHaveBeenNthCalledWith(1, 'unit-1');
        expect(repo.hasCommittedHistory).toHaveBeenNthCalledWith(2, 'unit-1', TX);
        expect(repo.updateUnit).toHaveBeenCalledWith('unit-1', { updatedById: 'owner-1', vin: 'NEWVIN' }, TX);
        expect(activityLog.recordInTransaction).toHaveBeenCalledTimes(1);
        expect(activityLog.recordInTransaction).toHaveBeenCalledWith(expect.objectContaining({
          metadata: { identificationCorrection: { reason: 'Typo at stock entry', changes: [{ field: 'vin', from: 'VIN123', to: 'NEWVIN' }] } },
        }), TX);
      });

      it.each(['DELIVERED', 'IN_SERVICE', 'RETURNED'])('%s: eligible by status, with or without history — no history query', async (status) => {
        at(status, false);
        await service.correctIdentification('unit-1', { batteryNumber: 'B2', reason: 'Typo at stock entry' } as never, OWNER);
        expect(repo.hasCommittedHistory).not.toHaveBeenCalled();
        expect(repo.lockUnit).toHaveBeenCalledWith('company-1', 'unit-1', TX);
        expect(activityLog.recordInTransaction).toHaveBeenCalledTimes(1);
      });

      it('a never-committed IN_SERVICE unit put back to AVAILABLE before the lock is no longer eligible', async () => {
        at('IN_SERVICE', false);
        repo.lockUnit.mockResolvedValue({ ...unit, status: 'AVAILABLE', motorNumber: 'M1', batteryNumber: 'B1' } as never);
        await expect(service.correctIdentification('unit-1', { vin: 'NEWVIN', reason: 'Typo at stock entry' } as never, OWNER)).rejects.toMatchObject({ status: 409, message: NOT_ELIGIBLE });
        nothingWritten();
      });

      it('an identity changed by someone else before the lock stops the correction (409, reload)', async () => {
        at('DELIVERED', false);
        repo.lockUnit.mockResolvedValue({ ...unit, status: 'DELIVERED', motorNumber: 'OTHER', batteryNumber: 'B1' } as never);
        await expect(service.correctIdentification('unit-1', { vin: 'NEWVIN', reason: 'Typo at stock entry' } as never, OWNER)).rejects.toMatchObject({ status: 409, message: CHANGED });
        nothingWritten();
      });
    });
  });

  describe('identificationCorrectionSchema', () => {
    const parse = (body: unknown) => identificationCorrectionSchema.safeParse(body);
    const messages = (body: unknown): string[] => {
      const r = parse(body);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };

    it('normalises identifiers exactly like the ordinary edit (trim + upper-case) and trims the reason', () => {
      expect(parse({ vin: '  md9abc123  ', motorNumber: ' m-1 ', batteryNumber: 'b1', reason: '  Typo at entry  ' })).toEqual({
        success: true, data: { vin: 'MD9ABC123', motorNumber: 'M-1', batteryNumber: 'B1', reason: 'Typo at entry' },
      });
    });

    it('requires a reason of at least 5 characters after trimming', () => {
      expect(messages({ vin: 'MD9ABC123' })).toEqual(['A reason is required']);
      expect(messages({ vin: 'MD9ABC123', reason: '' })).toEqual(['Give a reason of at least 5 characters']);
      expect(messages({ vin: 'MD9ABC123', reason: '   abcd   ' })).toEqual(['Give a reason of at least 5 characters']);
      expect(parse({ vin: 'MD9ABC123', reason: 'abcde' }).success).toBe(true);
    });

    it('requires at least one identifier', () => {
      expect(messages({ reason: 'Typo at entry' })).toEqual(['Give the VIN, motor number or battery number to correct']);
    });

    it('rejects model / variant / colour keys outright (M4B.4)', () => {
      for (const key of ['variantId', 'modelId', 'variant', 'colour', 'hexColour']) {
        expect(messages({ vin: 'MD9ABC123', reason: 'Typo at entry', [key]: 'x' })).toEqual(['Model, variant and colour cannot be changed by an identification correction']);
      }
    });

    it('strips anything else — the tenant and the actor never come from the request', () => {
      const r = parse({ vin: 'MD9ABC123', reason: 'Typo at entry', companyId: 'c', userId: 'u', status: 'AVAILABLE', notes: 'x' });
      expect(r.success && r.data).toEqual({ vin: 'MD9ABC123', reason: 'Typo at entry' });
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
