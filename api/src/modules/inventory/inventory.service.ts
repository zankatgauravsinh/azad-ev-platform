import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  Role,
  UnitStatus,
  buildPageMeta,
  canTransitionUnit,
  CSV_IMPORT_MAX_ROWS,
  type CsvImportPreview,
  type CreateUnitInput,
  type CsvImportResult,
  type ChangeUnitStatusInput,
  type IdentificationCorrectionInput,
  type ListUnitsQuery,
  type Paginated,
  type ReturnDisposition,
  type UnitIdentityPolicy,
  type UpdateUnitInput,
} from '@azad/shared';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { ExportService, type ExportData } from '../../export/export.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { formatInr } from '../../common/utils/money';
import { InventoryRepository } from './inventory.repository';
import { CatalogRepository, type VariantRow } from './catalog/catalog.repository';
import { TenantContext } from '../../tenant/tenant-context.service';
import { csvParseMessage, readCsvRows, type Catalogue, type CsvSourceRow } from './csv-import';
import { buildCsvPreview, identifierCandidates, validateCsvFile } from './csv-preview';

const LOW_STOCK_THRESHOLD = 2;
// High enough to export a whole dealership's stock in one file; a single
// showroom never approaches this, but exports must not silently truncate.
const EXPORT_CAP = 100_000;

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * A unit's catalogue identity (model / variant / colour) may be corrected only before it is committed to
 * a customer. From BOOKED on — and in every later state (DELIVERED, IN_SERVICE, RETURNED) — the invoice,
 * delivery note, service, warranty, AMC and return records all read that identity live, so changing it
 * would rewrite their history. The status itself is untouched by this rule.
 */
const IDENTITY_EDITABLE_STATUSES: ReadonlySet<UnitStatus> = new Set([UnitStatus.AVAILABLE, UnitStatus.RESERVED]);

/**
 * The vehicle's identification numbers (VIN, motor, battery) are locked from DELIVERY on — the invoice,
 * delivery note, warranty and service records are then in the customer's hands. A typo may still be
 * fixed while AVAILABLE, RESERVED or BOOKED (the pre-handover check) through the ordinary edit.
 */
const IDENTIFICATION_EDITABLE_STATUSES: ReadonlySet<UnitStatus> = new Set([UnitStatus.AVAILABLE, UnitStatus.RESERVED, UnitStatus.BOOKED]);

/**
 * After handover the numbers can only be CORRECTED (M4B.3): owner-only, with a reason, through
 * `correctIdentification`. It changes the unit alone — bookings, sales, deliveries, warranties, service
 * jobs, AMC plans, returns and GST snapshots keep what they recorded — and the audit entry explains it.
 * The same applies to any vehicle with committed history, whatever its status (M4B.4).
 */
const IDENTIFICATION_CORRECTION_STATUSES: ReadonlySet<UnitStatus> = new Set([UnitStatus.DELIVERED, UnitStatus.IN_SERVICE, UnitStatus.RETURNED]);

/*
 * M4B.4 — historical commitment. A vehicle with a Sale (invoiced), a Warranty or an AMC plan keeps its
 * identity protected for good, even when its status later returns to AVAILABLE / RESERVED / BOOKED (e.g.
 * restocked after a return). The status rules above still apply as well; history only adds protection.
 */
const MSG_IDENTIFICATION_AFTER_DELIVERY = 'Vehicle identification cannot be changed after delivery.';
const MSG_IDENTIFICATION_HISTORY = 'Vehicle identification cannot be changed once the vehicle has a sale, warranty or AMC history — use the owner identification correction.';
const MSG_VARIANT_AFTER_BOOKING = 'Vehicle model/variant cannot be changed after booking or delivery.';
const MSG_VARIANT_HISTORY = 'Vehicle model/variant cannot be changed once the vehicle has a sale, warranty or AMC history.';
const MSG_CORRECTION_NOT_ELIGIBLE = 'Identification correction applies only to delivered, in-service or returned vehicles, or to vehicles with a sale, warranty or AMC history — edit this vehicle instead.';
const MSG_CHANGED_CONCURRENTLY = 'This vehicle was changed by someone else — reload and try again.';

/**
 * The rules above, as the read-only policy the unit's detail carries for the UI (M4C). The same status
 * sets and the same history check the guards below enforce — the guards remain authoritative.
 */
export function unitIdentityPolicy(status: UnitStatus, committed: boolean): UnitIdentityPolicy {
  return {
    committed,
    catalogueEditable: IDENTITY_EDITABLE_STATUSES.has(status) && !committed,
    identificationEditable: IDENTIFICATION_EDITABLE_STATUSES.has(status) && !committed,
    correctionEligible: IDENTIFICATION_CORRECTION_STATUSES.has(status) || committed,
  };
}

/** A lazily evaluated, memoised "has committed history" check (one query at most). */
type HistoryCheck = () => Promise<boolean>;
const once = (query: () => Promise<boolean>): HistoryCheck => {
  let result: Promise<boolean> | null = null;
  return () => (result ??= query());
};

const IDENTIFICATION_FIELDS = ['vin', 'motorNumber', 'batteryNumber'] as const;
type IdentificationField = (typeof IDENTIFICATION_FIELDS)[number];
type IdentificationChange = { field: IdentificationField; from: string; to: string };
type IdentitySnapshot = Record<IdentificationField, string> & { variantId: string };
const sameIdentity = (a: IdentitySnapshot, b: IdentitySnapshot): boolean =>
  a.variantId === b.variantId && IDENTIFICATION_FIELDS.every((f) => a[f] === b[f]);

/**
 * Only an ACTUAL change counts: a field that is sent and differs from the stored value. Inputs are
 * already normalised by the shared schema (trimmed, upper-cased), like the stored values, so a
 * case-only or whitespace-only difference is not a change. Fields are reported in a fixed order.
 */
const identificationChangesOf = (
  existing: Record<IdentificationField, string>,
  requested: Partial<Record<IdentificationField, string>>,
): IdentificationChange[] =>
  IDENTIFICATION_FIELDS.flatMap((field) => {
    const to = requested[field];
    return to !== undefined && to !== existing[field] ? [{ field, from: existing[field], to }] : [];
  });

/** A plain JSON object (type alias, not an interface) so it can ride in the activity-log metadata. */
type IdentityRef = { variantId: string; modelId: string; brand: string; model: string; variant: string; colour: string; label: string };
const identityRef = (v: { id: string; name: string; colour: string; model: { id: string; brand: string; name: string } }): IdentityRef => ({
  variantId: v.id, modelId: v.model.id, brand: v.model.brand, model: v.model.name, variant: v.name, colour: v.colour,
  label: `${v.model.brand} ${v.model.name} ${v.name} (${v.colour})`,
});

/** M4D.3 — an import (up to CSV_IMPORT_MAX_ROWS rows) runs in one transaction; give it room. */
const CSV_IMPORT_TX_TIMEOUT_MS = 60_000;
const CSV_IMPORT_TX_MAX_WAIT_MS = 10_000;

/** Thrown inside the import transaction to roll it back and answer REJECTED with the validation. */
class CsvImportRejected extends Error {
  constructor(readonly preview: CsvImportPreview) {
    super('CSV import rejected');
  }
}

/**
 * Thrown inside the import transaction when the re-check after locking resolves a row to a catalogue
 * entry this transaction does not hold (it was renamed between the first check and the lock). Rolls back.
 */
class CsvImportCatalogueChanged extends Error {
  constructor() {
    super('CSV import: catalogue changed under the import');
  }
}

const rejectedImport = (preview: CsvImportPreview): CsvImportResult => {
  const invalid = preview.rows.filter((r) => r.status === 'INVALID');
  return {
    status: 'REJECTED',
    created: 0,
    failed: invalid.length,
    errors: invalid.map((r) => ({ row: r.row, message: r.issues.map((i) => i.message).join(' ') })),
    fileSha256: preview.fileSha256,
    preview,
  };
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Postgres gave up on the transaction because of another one — deadlock (40P01) or serialization failure
 * (40001). Prisma reports it as P2034, as P2010 from raw SQL, and — for createMany — as an unknown request
 * error whose message carries the Postgres code (there is no structured field to read it from).
 */
const CONCURRENCY_ABORT_CODES = ['40P01', '40001'];
const isConcurrencyAbort = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034' || (error.code === 'P2010' && CONCURRENCY_ABORT_CODES.includes(String((error.meta as { code?: unknown } | undefined)?.code)));
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && /\bcode: "(40P01|40001)"/.test(error.message);
};

/** The interactive transaction could not start in time (maxWait) or ran past its timeout. */
const isTransactionTimeout = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';

@Injectable()
export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly activityLog: ActivityLogService,
    private readonly exporter: ExportService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly catalog: CatalogRepository,
    private readonly tenant: TenantContext,
  ) {}

  // ── Reads ──────────────────────────────────────────────
  async list(query: ListUnitsQuery): Promise<Paginated<unknown>> {
    const where = this.buildWhere(query);
    const [data, total] = await Promise.all([
      this.repo.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.repo.count(where),
    ]);
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async stats() {
    const s = await this.repo.stats();
    return {
      total: s.total,
      available: s.AVAILABLE,
      reserved: s.RESERVED,
      booked: s.BOOKED,
      delivered: s.DELIVERED,
      inService: s.IN_SERVICE,
      returned: s.RETURNED,
    };
  }

  async dashboard() {
    const [stats, recentlyAdded, reserved, readyForDelivery, lowInventory] = await Promise.all([
      this.stats(),
      this.repo.recentlyAdded(5),
      this.repo.findByStatus(UnitStatus.RESERVED, 5),
      this.repo.findByStatus(UnitStatus.BOOKED, 5),
      this.computeLowInventory(),
    ]);
    return { stats, recentlyAdded, reserved, readyForDelivery, lowInventory };
  }

  private async computeLowInventory(): Promise<{ model: string; brand: string; available: number }[]> {
    const availableUnits = await this.repo.findByStatus(UnitStatus.AVAILABLE, EXPORT_CAP);
    const counts = new Map<string, { model: string; brand: string; available: number }>();
    for (const unit of availableUnits) {
      const model = unit.variant.model;
      const entry = counts.get(model.id) ?? { model: model.name, brand: model.brand, available: 0 };
      entry.available += 1;
      counts.set(model.id, entry);
    }
    // Include active models with zero available too.
    const models = await this.repo.findModels();
    for (const m of models) {
      if (!counts.has(m.id)) counts.set(m.id, { model: m.name, brand: m.brand, available: 0 });
    }
    return [...counts.values()]
      .filter((c) => c.available <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.available - b.available);
  }

  async getById(id: string) {
    const unit = await this.repo.findDetail(id);
    if (!unit) throw new NotFoundException('Scooter not found');
    const committed = await this.repo.hasCommittedHistory(id);
    return {
      ...unit,
      identity: unitIdentityPolicy(unit.status as UnitStatus, committed),
      photos: unit.photos.map((p) => ({
        id: p.id,
        fileKey: p.fileKey,
        url: this.storage.urlFor(p.fileKey),
        label: p.label,
        createdAt: p.createdAt,
      })),
      documents: unit.documents.map((d) => ({
        id: d.id,
        type: d.type,
        fileKey: d.fileKey,
        url: this.storage.urlFor(d.fileKey),
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        createdAt: d.createdAt,
      })),
    };
  }

  async getEvents(id: string) {
    await this.getUnitOrThrow(id);
    return this.repo.findEvents(id);
  }

  async checkVin(vin: string): Promise<{ exists: boolean }> {
    const found = await this.repo.findByVin(vin.trim().toUpperCase());
    return { exists: Boolean(found) };
  }

  // ── Writes ─────────────────────────────────────────────
  async create(dto: CreateUnitInput, userId: string) {
    await this.assertVinAvailable(dto.vin);
    // Curated: an existing active variant, checked against the tenant before anything is written.
    const curated = dto.variantId ? await this.curatedVariant(dto.variantId) : null;
    const unit = await this.repo.transaction(async (tx) => {
      const variant = curated ?? (await this.legacyVariant(tx, dto));
      // The list price is only the INITIAL value of a curated unit's selling price; the unit's own
      // price is independent from here on (a later list-price change never touches it).
      const sellingPrice = dto.sellingPrice !== undefined ? BigInt(dto.sellingPrice) : curated ? curated.exShowroomPrice : 0n;
      const created = await this.repo.createUnit(
        {
          variant: { connect: { id: variant.id } },
          vin: dto.vin,
          motorNumber: dto.motorNumber,
          batteryNumber: dto.batteryNumber,
          status: dto.status,
          purchaseDate: dto.purchaseDate ?? null,
          purchaseCost: BigInt(dto.purchaseCost),
          sellingPrice,
          supplier: dto.supplier ?? null,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
          updatedById: userId,
        },
        tx,
      );
      await this.repo.addEvent(
        {
          unitId: created.id,
          fromStatus: null,
          toStatus: created.status,
          note: 'Purchased / added to inventory',
          createdById: userId,
        },
        tx,
      );
      return created;
    });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.CREATE,
      entityType: 'InventoryUnit',
      entityId: unit.id,
      summary: `Added scooter ${unit.vin} (${unit.variant.model.name} ${unit.variant.name})`,
    });
    return unit;
  }

  async update(id: string, dto: UpdateUnitInput, userId: string) {
    const existing = await this.getUnitOrThrow(id);
    // Identification: only an ACTUAL change counts (inputs are already normalised upper-case by the
    // schema, like the stored values). Refused as a whole after delivery — before anything is checked
    // or written, so the request leaves no trace.
    const identificationChanges = identificationChangesOf(existing, dto);
    if (identificationChanges.length > 0) {
      await this.assertIdentificationEditable(existing.status as UnitStatus, once(() => this.repo.hasCommittedHistory(id)));
    }
    if (dto.vin && dto.vin !== existing.vin) {
      await this.assertVinAvailable(dto.vin);
    }
    // Curated selection is validated against the tenant first (404 / 409), before any status rule.
    const curated = dto.variantId !== undefined ? await this.curatedVariant(dto.variantId) : null;

    const identity: { change: { from: IdentityRef; to: IdentityRef } | null } = { change: null }; // set inside the transaction
    const touchesIdentity = IDENTIFICATION_FIELDS.some((f) => dto[f] !== undefined)
      || dto.variantId !== undefined || dto.modelId !== undefined || dto.variant !== undefined || dto.colour !== undefined;
    const unit = await this.repo.transaction(async (tx) => {
      const data: Prisma.InventoryUnitUpdateInput = { updatedById: userId };

      // The checks above are a fast refusal; the authoritative ones run here, on the locked row, so an
      // invoice / warranty / AMC plan created meanwhile is seen (see InventoryRepository.lockUnit).
      let status = existing.status as UnitStatus;
      const committed = once(() => this.repo.hasCommittedHistory(id, tx));
      if (touchesIdentity) {
        status = (await this.lockedUnchanged(id, existing, tx)).status;
        if (identificationChanges.length > 0) await this.assertIdentificationEditable(status, committed);
      }

      // The catalogue identity the request asks for — curated (wins over any free-text sent alongside)
      // or legacy text resolved exactly as before (the resolver may create a variant; a refusal below
      // rolls that back with everything else).
      let target: { id: string; name: string; colour: string; model: { id: string; brand: string; name: string } } | null = curated;
      if (!target && (dto.modelId !== undefined || dto.variant !== undefined || dto.colour !== undefined)) {
        const resolved = await this.resolveVariant(
          tx,
          dto.modelId ?? existing.variant.modelId,
          dto.variant ?? existing.variant.name,
          dto.colour ?? existing.variant.colour,
          dto.hexColour ?? existing.variant.hexColour ?? undefined,
          dto.sellingPrice !== undefined ? BigInt(dto.sellingPrice) : existing.variant.exShowroomPrice,
        );
        target = { ...resolved, model: existing.variant.modelId === resolved.modelId ? existing.variant.model : await this.modelRef(resolved.modelId) };
      }
      // Only an ACTUAL change of variant is a reassignment: naming the current variant (by id or by the
      // same model / variant / colour) is not, whatever the status.
      if (target && target.id !== existing.variantId) {
        if (!IDENTITY_EDITABLE_STATUSES.has(status)) throw new ConflictException(MSG_VARIANT_AFTER_BOOKING);
        if (await committed()) throw new ConflictException(MSG_VARIANT_HISTORY);
        data.variant = { connect: { id: target.id } };
        identity.change = { from: identityRef(existing.variant), to: identityRef(target) };
      }
      if (dto.vin !== undefined) data.vin = dto.vin;
      if (dto.motorNumber !== undefined) data.motorNumber = dto.motorNumber;
      if (dto.batteryNumber !== undefined) data.batteryNumber = dto.batteryNumber;
      if (dto.purchaseDate !== undefined) data.purchaseDate = dto.purchaseDate;
      if (dto.purchaseCost !== undefined) data.purchaseCost = BigInt(dto.purchaseCost);
      if (dto.sellingPrice !== undefined) data.sellingPrice = BigInt(dto.sellingPrice);
      if (dto.supplier !== undefined) data.supplier = dto.supplier ?? null;
      if (dto.location !== undefined) data.location = dto.location ?? null;
      if (dto.notes !== undefined) data.notes = dto.notes ?? null;

      return this.repo.updateUnit(id, data, tx);
    });

    // One UPDATE entry per request; what changed about the vehicle's identity rides in the metadata.
    const parts = [
      ...(identity.change ? [`variant ${identity.change.from.label} → ${identity.change.to.label}`] : []),
      ...identificationChanges.map((c) => `${c.field} ${c.from} → ${c.to}`),
    ];
    const metadata = {
      ...(identity.change ? { variantChange: identity.change } : {}),
      ...(identificationChanges.length > 0 ? { identificationChanges } : {}),
    };
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'InventoryUnit',
      entityId: id,
      summary: parts.length > 0 ? `Updated scooter ${existing.vin}: ${parts.join('; ')}` : `Updated scooter ${unit.vin}`,
      ...(parts.length > 0 ? { metadata } : {}),
    });
    return unit;
  }

  /**
   * M4B.3 — corrects the VIN / motor / battery number of a DELIVERED, IN_SERVICE or RETURNED vehicle.
   * Owner-only, reason required, at least one actual change. Everything is validated before anything
   * is written; the unit update and its single audit entry then commit (or roll back) together, and a
   * uniqueness clash leaves no trace. Only the unit changes: historical records are not rewritten.
   */
  async correctIdentification(id: string, dto: IdentificationCorrectionInput, actor: { id: string; role: Role }) {
    // The route is already owner-only; this keeps the rule true for any other caller of the service.
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only the owner can correct vehicle identification after delivery.');
    const existing = await this.getUnitOrThrow(id);
    await this.assertCorrectionEligible(existing.status as UnitStatus, once(() => this.repo.hasCommittedHistory(id)));
    const changes = identificationChangesOf(existing, dto);
    if (changes.length === 0) {
      throw new BadRequestException('Nothing to correct: the identification given matches the vehicle.');
    }
    // Uniqueness exactly as an ordinary edit: the VIN pre-check here, the database constraints for all
    // three at write time (a clash there rolls the whole transaction back).
    const vinChange = changes.find((c) => c.field === 'vin');
    if (vinChange) await this.assertVinAvailable(vinChange.to);

    const data: Prisma.InventoryUnitUpdateInput = { updatedById: actor.id };
    for (const change of changes) data[change.field] = change.to;
    const identificationCorrection = { reason: dto.reason, changes };

    return this.repo.transaction(async (tx) => {
      // Re-checked on the locked row: the eligibility seen above still holds when the update is written.
      const locked = await this.lockedUnchanged(id, existing, tx);
      await this.assertCorrectionEligible(locked.status, once(() => this.repo.hasCommittedHistory(id, tx)));
      const unit = await this.repo.updateUnit(id, data, tx);
      await this.activityLog.recordInTransaction({
        actorId: actor.id,
        action: ActivityAction.UPDATE,
        entityType: 'InventoryUnit',
        entityId: id,
        summary: `Updated scooter ${existing.vin}: ${changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join('; ')} (identification correction)`,
        metadata: { identificationCorrection },
      }, tx);
      return unit;
    });
  }

  /** Ordinary edit of VIN / motor / battery: the M4B.2 status rule, then historical commitment (M4B.4). */
  private async assertIdentificationEditable(status: UnitStatus, committed: HistoryCheck): Promise<void> {
    if (!IDENTIFICATION_EDITABLE_STATUSES.has(status)) throw new ConflictException(MSG_IDENTIFICATION_AFTER_DELIVERY);
    if (await committed()) throw new ConflictException(MSG_IDENTIFICATION_HISTORY);
  }

  /** Correction: delivered / in-service / returned by status (M4B.3), or any vehicle with committed history (M4B.4). */
  private async assertCorrectionEligible(status: UnitStatus, committed: HistoryCheck): Promise<void> {
    if (IDENTIFICATION_CORRECTION_STATUSES.has(status)) return;
    if (!(await committed())) throw new ConflictException(MSG_CORRECTION_NOT_ELIGIBLE);
  }

  /**
   * Locks the unit for the transaction and returns its current state. Its identity must still be the
   * one this request was validated against; otherwise another change won the race and this one stops.
   */
  private async lockedUnchanged(id: string, existing: IdentitySnapshot, tx: Prisma.TransactionClient) {
    const locked = await this.repo.lockUnit(this.tenant.requireCompanyId(), id, tx);
    if (!locked) throw new NotFoundException('Scooter not found');
    if (!sameIdentity(locked, existing)) throw new ConflictException(MSG_CHANGED_CONCURRENTLY);
    return locked;
  }

  private async modelRef(modelId: string): Promise<{ id: string; brand: string; name: string }> {
    const model = await this.repo.findModelById(modelId);
    if (!model) throw new NotFoundException('Selected model does not exist');
    return { id: model.id, brand: model.brand, name: model.name };
  }

  async remove(id: string, userId: string): Promise<void> {
    const unit = await this.getUnitOrThrow(id);
    if (unit.status === UnitStatus.BOOKED || unit.status === UnitStatus.DELIVERED) {
      throw new ConflictException(
        `Cannot delete a ${unit.status.toLowerCase()} scooter — it is linked to a booking/sale`,
      );
    }
    await this.repo.softDelete(id);
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.DELETE,
      entityType: 'InventoryUnit',
      entityId: id,
      summary: `Deleted scooter ${unit.vin}`,
    });
  }

  async changeStatus(id: string, dto: ChangeUnitStatusInput, userId: string) {
    const unit = await this.getUnitOrThrow(id);
    if (unit.status === dto.toStatus) {
      throw new BadRequestException(`Scooter is already ${dto.toStatus}`);
    }
    if (!canTransitionUnit(unit.status as UnitStatus, dto.toStatus)) {
      throw new BadRequestException(`Cannot change status from ${unit.status} to ${dto.toStatus}`);
    }
    // A vehicle enters and leaves RETURNED only through the approved vehicle-return
    // workflow (request → inspection → approval → completion). The generic status API
    // must never let a delivered vehicle be walked back into sellable stock — that would
    // bypass the credit note, refund and inspection and let a sold unit be resold.
    if (dto.toStatus === UnitStatus.RETURNED) {
      throw new BadRequestException('A vehicle can only be marked RETURNED through the vehicle-return workflow');
    }
    if (unit.status === UnitStatus.RETURNED) {
      throw new BadRequestException('A returned vehicle re-enters stock only via an approved return inspection');
    }
    // A BOOKED unit belongs to a live booking; manually re-statusing it here would
    // orphan that booking (and could re-open the unit for a second sale).
    if (unit.status === UnitStatus.BOOKED) {
      const active = await this.repo.activeBooking(id);
      if (active) {
        throw new ConflictException(`Scooter ${unit.vin} is reserved by booking ${active.code} — cancel or complete that booking first`);
      }
    }
    const updated = await this.repo.transaction(async (tx) => {
      const u = await this.repo.updateUnit(id, { status: dto.toStatus, updatedById: userId }, tx);
      await this.repo.addEvent(
        {
          unitId: id,
          fromStatus: unit.status,
          toStatus: dto.toStatus,
          note: dto.note ?? null,
          createdById: userId,
        },
        tx,
      );
      return u;
    });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.STATUS_CHANGE,
      entityType: 'InventoryUnit',
      entityId: id,
      summary: `${unit.vin}: ${unit.status} → ${dto.toStatus}`,
      metadata: { from: unit.status, to: dto.toStatus, note: dto.note ?? null },
    });
    return updated;
  }

  /**
   * Completes a vehicle return's inventory effect: DELIVERED → RETURNED → disposition.
   * Called ONLY from the return-completion transaction (the generic changeStatus API is
   * deliberately locked out of RETURNED). Runs on the caller's transaction, so a failure
   * anywhere in completion rolls this back too. SCRAP leaves the unit at RETURNED
   * (non-sellable); AVAILABLE / IN_SERVICE re-stock it.
   */
  async applyReturnDisposition(unitId: string, disposition: ReturnDisposition, userId: string, tx: Prisma.TransactionClient): Promise<void> {
    const unit = await tx.inventoryUnit.findFirst({ where: { id: unitId }, select: { id: true, status: true, vin: true } });
    if (!unit) throw new NotFoundException('Scooter not found');
    if (unit.status !== UnitStatus.DELIVERED) {
      throw new ConflictException(`Scooter ${unit.vin} is ${unit.status}, not DELIVERED — cannot complete the return`);
    }
    await this.repo.updateUnit(unitId, { status: UnitStatus.RETURNED, updatedById: userId }, tx);
    await this.repo.addEvent({ unitId, fromStatus: UnitStatus.DELIVERED, toStatus: UnitStatus.RETURNED, note: 'Vehicle return completed', createdById: userId }, tx);
    if (disposition === 'AVAILABLE' || disposition === 'IN_SERVICE') {
      await this.repo.updateUnit(unitId, { status: disposition as UnitStatus, updatedById: userId }, tx);
      await this.repo.addEvent({ unitId, fromStatus: UnitStatus.RETURNED, toStatus: disposition as UnitStatus, note: `Return disposition: ${disposition}`, createdById: userId }, tx);
    }
  }

  // ── Bulk CSV import ────────────────────────────────────
  /**
   * M4D.3 — confirmed import, ALL OR NOTHING. Inside one transaction the whole file is validated against
   * the current catalogue and inventory (exactly the preview's rules — the preview itself is never
   * trusted); the catalogue rows it uses are share-locked and the file validated again; then every unit,
   * its history event and one audit entry are written. Any invalid row, or a number taken concurrently
   * (unique-constraint race), leaves nothing behind; a deadlock with another import is answered like that
   * race, a transaction timeout with 503. `expectedSha256` ties the request to the previewed file.
   */
  async importCsv(file: UploadedFile, userId: string, expectedSha256?: string): Promise<CsvImportResult> {
    const companyId = this.tenant.requireCompanyId();
    const { rows, fileSha256 } = this.readCsvFile(file);
    if (expectedSha256 !== undefined && expectedSha256.toLowerCase() !== fileSha256) {
      throw new ConflictException('This is not the file that was previewed — preview it again before importing.');
    }
    if (rows.length === 0) throw new BadRequestException('The file has no rows to import.');
    const validate = async (db?: Prisma.TransactionClient) =>
      validateCsvFile(rows, await this.csvCatalogue(companyId, db), await this.repo.findUsedIdentifiers(identifierCandidates(rows), companyId, db), CSV_IMPORT_MAX_ROWS, new Date(), fileSha256);

    try {
      return await this.repo.transaction(async (tx) => {
        const first = await validate(tx);
        if (first.preview.summary.invalid > 0) throw new CsvImportRejected(first.preview);
        // Hold the catalogue rows this file uses (no deactivation / rename until we commit), then re-check.
        const variantIds = [...new Set(first.units.map((u) => u.variantId))];
        const modelIds = [...new Set(first.preview.rows.map((r) => r.unit!.modelId))];
        const locked = await this.repo.lockCatalogueRows(companyId, modelIds, variantIds, tx);
        const { preview, units } = await validate(tx);
        if (preview.summary.invalid > 0) throw new CsvImportRejected(preview);
        // The re-check must resolve every row to a row we hold: a rename committed between the first check
        // and the lock can make a name match a different (unlocked) model or variant — never import into it.
        const unlocked =
          units.some((u) => !locked.variantIds.has(u.variantId)) ||
          preview.rows.some((r) => r.unit !== null && (!locked.modelIds.has(r.unit.modelId) || !locked.variantIds.has(r.unit.variantId)));
        if (unlocked) throw new CsvImportCatalogueChanged();

        const created = units.map((u) => ({ ...u, id: randomUUID() }));
        await this.repo.createUnits(created.map((u) => ({
          id: u.id,
          variantId: u.variantId,
          vin: u.vin,
          motorNumber: u.motorNumber,
          batteryNumber: u.batteryNumber,
          status: UnitStatus.AVAILABLE,
          purchaseDate: u.purchaseDate,
          purchaseCost: u.purchaseCost,
          sellingPrice: u.sellingPrice,
          supplier: u.supplier,
          location: u.location,
          createdById: userId,
          updatedById: userId,
        })), tx);
        await this.repo.addEvents(created.map((u) => ({ unitId: u.id, fromStatus: null, toStatus: UnitStatus.AVAILABLE, note: 'Imported via CSV', createdById: userId })), tx);
        await this.activityLog.recordInTransaction({
          actorId: userId,
          action: ActivityAction.CREATE,
          entityType: 'InventoryUnit',
          summary: `CSV import: ${created.length} scooters added`,
          metadata: { created: created.length, fileSha256 },
        }, tx);
        return { status: 'IMPORTED', created: created.length, failed: 0, errors: [], fileSha256, preview: null } satisfies CsvImportResult;
      }, { timeout: CSV_IMPORT_TX_TIMEOUT_MS, maxWait: CSV_IMPORT_TX_MAX_WAIT_MS });
    } catch (error) {
      if (error instanceof CsvImportRejected) return rejectedImport(error.preview);
      if (error instanceof CsvImportCatalogueChanged) {
        throw new ConflictException('The catalogue changed while importing — nothing was imported. Preview the file again.');
      }
      if (isUniqueViolation(error) || isConcurrencyAbort(error)) {
        // A number was taken by a concurrent import or edit after validation (or Postgres aborted us in favour
        // of one); the whole import rolled back. Validate again (outside the failed transaction) to name the rows.
        const { preview } = await validate();
        if (preview.summary.invalid > 0) return rejectedImport(preview);
        throw new ConflictException('Inventory changed while importing — nothing was imported. Try again.');
      }
      if (isTransactionTimeout(error)) {
        throw new ServiceUnavailableException('The import could not finish in time — nothing was imported. Try again, or split the file into smaller files.');
      }
      throw error;
    }
  }

  /**
   * M4D.2 — import PREVIEW (dry run): validates every row exactly as importCsv does and writes nothing
   * (no unit, no catalogue entry, no event, no activity log). Advisory: the import re-validates.
   */
  async previewCsv(file: UploadedFile): Promise<CsvImportPreview> {
    const companyId = this.tenant.requireCompanyId();
    const { rows, fileSha256 } = this.readCsvFile(file);
    const [catalogue, used] = await Promise.all([this.csvCatalogue(companyId), this.repo.findUsedIdentifiers(identifierCandidates(rows), companyId)]);
    return buildCsvPreview(rows, catalogue, used, CSV_IMPORT_MAX_ROWS, new Date(), fileSha256);
  }

  /** Parses the file (400 when unreadable or over the row limit) and hashes its bytes. */
  private readCsvFile(file: UploadedFile): { rows: CsvSourceRow[]; fileSha256: string } {
    let rows: CsvSourceRow[];
    try {
      rows = readCsvRows(file.buffer, (h) => this.normalizeHeader(h));
    } catch (error) {
      throw new BadRequestException(csvParseMessage(error));
    }
    if (rows.length > CSV_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`The file has ${rows.length} rows; at most ${CSV_IMPORT_MAX_ROWS} can be imported at once — split it into smaller files.`);
    }
    return { rows, fileSha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  /** The company's whole catalogue, active and inactive (inactive is reported as such). */
  private async csvCatalogue(companyId: string, db?: Prisma.TransactionClient): Promise<Catalogue> {
    const [models, variants] = await Promise.all([
      db ? this.catalog.listModels(companyId, { status: 'all' }, db) : this.catalog.listModels(companyId, { status: 'all' }),
      db ? this.catalog.listVariants(companyId, { status: 'all' }, db) : this.catalog.listVariants(companyId, { status: 'all' }),
    ]);
    return { models, variants };
  }

  // ── Export ─────────────────────────────────────────────
  async export(
    query: ListUnitsQuery,
    format: 'xlsx' | 'pdf',
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where = this.buildWhere(query);
    const units = await this.repo.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: 0,
      take: EXPORT_CAP,
    });

    const data: ExportData = {
      title: 'Inventory',
      columns: [
        { header: 'VIN', width: 2 },
        { header: 'Model', width: 1.4 },
        { header: 'Variant', width: 1.4 },
        { header: 'Colour', width: 1 },
        { header: 'Status', width: 1.2 },
        { header: 'Motor No', width: 1.6 },
        { header: 'Battery No', width: 1.6 },
        { header: 'Purchase Date', width: 1.3 },
        { header: 'Purchase Cost', width: 1.3 },
        { header: 'Selling Price', width: 1.3 },
        { header: 'Supplier', width: 1.4 },
      ],
      rows: units.map((u) => [
        u.vin,
        u.variant.model.name,
        u.variant.name,
        u.variant.colour,
        u.status,
        u.motorNumber,
        u.batteryNumber,
        u.purchaseDate ? new Date(u.purchaseDate).toLocaleDateString('en-IN') : '—',
        formatInr(u.purchaseCost),
        formatInr(u.sellingPrice),
        u.supplier ?? '—',
      ]),
    };

    const stamp = new Date().toISOString().slice(0, 10);
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.EXPORT,
      entityType: 'InventoryUnit',
      summary: `Exported inventory (${format}, ${units.length} rows)`,
    });

    if (format === 'xlsx') {
      return {
        buffer: await this.exporter.toExcel(data),
        filename: `inventory-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return {
      buffer: await this.exporter.toPdf(data),
      filename: `inventory-${stamp}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── Photos ─────────────────────────────────────────────
  async addPhoto(id: string, file: UploadedFile, label: string | undefined, userId: string) {
    await this.getUnitOrThrow(id);
    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `inventory-units/${id}`,
    });
    try {
      const photo = await this.repo.addPhoto({
        unitId: id,
        fileKey: stored.fileKey,
        label: label ?? null,
        createdById: userId,
        updatedById: userId,
      });
      return { ...photo, url: this.storage.urlFor(photo.fileKey) };
    } catch (error) {
      // Roll back the stored file so a failed insert leaves no orphan.
      await this.storage.remove(stored.fileKey).catch(() => undefined);
      throw error;
    }
  }

  listPhotos(id: string) {
    return this.repo.listPhotos(id).then((photos) =>
      photos.map((p) => ({ ...p, url: this.storage.urlFor(p.fileKey) })),
    );
  }

  async removePhoto(id: string, photoId: string): Promise<void> {
    const photo = await this.repo.findPhoto(photoId);
    if (!photo || photo.unitId !== id) throw new NotFoundException('Photo not found');
    await this.repo.deletePhoto(photoId);
    await this.storage.remove(photo.fileKey);
  }

  // ── Documents ──────────────────────────────────────────
  async addDocument(
    id: string,
    file: UploadedFile,
    type: string,
    userId: string,
  ) {
    await this.getUnitOrThrow(id);
    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `inventory-units/${id}`,
    });
    try {
      const doc = await this.repo.addDocument({
        unitId: id,
        type: type as Prisma.InventoryUnitDocumentUncheckedCreateInput['type'],
        fileKey: stored.fileKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        createdById: userId,
        updatedById: userId,
      });
      return { ...doc, url: this.storage.urlFor(doc.fileKey) };
    } catch (error) {
      await this.storage.remove(stored.fileKey).catch(() => undefined);
      throw error;
    }
  }

  listDocuments(id: string) {
    return this.repo.listDocuments(id).then((docs) =>
      docs.map((d) => ({ ...d, url: this.storage.urlFor(d.fileKey) })),
    );
  }

  async removeDocument(id: string, docId: string): Promise<void> {
    const doc = await this.repo.findDocument(docId);
    if (!doc || doc.unitId !== id) throw new NotFoundException('Document not found');
    await this.repo.deleteDocument(docId);
    await this.storage.remove(doc.fileKey);
  }

  // ── Models (for the add form) ──────────────────────────
  // Models and variants are managed by the CatalogService / CatalogController. The remaining IMPLICIT
  // creation below (resolveVariant on a legacy free-text unit create / update) is retired in M4E; the CSV
  // import no longer creates catalogue entries (M4D.1).

  // ── Helpers ────────────────────────────────────────────
  private async getUnitOrThrow(id: string) {
    const unit = await this.repo.findByIdWithVariant(id);
    if (!unit) throw new NotFoundException('Scooter not found');
    return unit;
  }

  /**
   * The curated variant a unit is being attached to: this company's, with this company's model, both
   * active. Another company's id is simply not found (404); an inactive model or variant is a 409.
   */
  private async curatedVariant(variantId: string): Promise<VariantRow> {
    const found = await this.catalog.findActiveVariantForUnit(this.tenant.requireCompanyId(), variantId);
    if ('variant' in found) return found.variant;
    if (found.error === 'NOT_FOUND') throw new NotFoundException('Variant not found');
    throw new ConflictException(found.error === 'MODEL_INACTIVE' ? 'The model of this variant is inactive — activate it before adding stock' : 'This variant is inactive — activate it before adding stock');
  }

  /** LEGACY (until M4E): free-text model + variant + colour, creating the variant when new. */
  private legacyVariant(tx: Prisma.TransactionClient, dto: CreateUnitInput) {
    if (!dto.modelId || !dto.variant || !dto.colour) throw new BadRequestException('Select a variant, or give model, variant and colour');
    return this.resolveVariant(tx, dto.modelId, dto.variant, dto.colour, dto.hexColour, BigInt(dto.sellingPrice ?? 0));
  }

  private async assertVinAvailable(vin: string): Promise<void> {
    const found = await this.repo.findByVin(vin);
    if (found) throw new ConflictException(`A scooter with VIN ${vin} already exists`);
  }

  private async resolveVariant(
    tx: Prisma.TransactionClient,
    modelId: string,
    name: string,
    colour: string,
    hexColour: string | undefined,
    defaultPrice: bigint,
  ) {
    const model = await this.repo.findModelById(modelId);
    if (!model) throw new NotFoundException('Selected model does not exist');
    const existing = await this.repo.findVariant(modelId, name, colour, tx);
    if (existing) return existing;
    return this.repo.createVariant(
      {
        model: { connect: { id: modelId } },
        name,
        colour,
        hexColour: hexColour ?? null,
        exShowroomPrice: defaultPrice,
      },
      tx,
    );
  }

  private normalizeHeader(header: string): string {
    const key = header.toLowerCase().replace(/[\s_-]+/g, '');
    const map: Record<string, string> = {
      brand: 'brand',
      make: 'brand',
      model: 'model',
      variant: 'variant',
      colour: 'colour',
      color: 'colour',
      vin: 'vin',
      motornumber: 'motorNumber',
      motorno: 'motorNumber',
      motor: 'motorNumber',
      batterynumber: 'batteryNumber',
      batteryno: 'batteryNumber',
      battery: 'batteryNumber',
      purchasedate: 'purchaseDate',
      purchasecost: 'purchaseCost',
      cost: 'purchaseCost',
      sellingprice: 'sellingPrice',
      price: 'sellingPrice',
      supplier: 'supplier',
      location: 'location',
      status: 'status',
    };
    return map[key] ?? key;
  }

  private buildWhere(query: ListUnitsQuery): Prisma.InventoryUnitWhereInput {
    const where: Prisma.InventoryUnitWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplier) where.supplier = { contains: query.supplier, mode: 'insensitive' };
    if (query.modelId) where.variant = { modelId: query.modelId };
    if (query.q) {
      const q = query.q.trim();
      where.OR = [
        { vin: { contains: q, mode: 'insensitive' } },
        { motorNumber: { contains: q, mode: 'insensitive' } },
        { batteryNumber: { contains: q, mode: 'insensitive' } },
        { supplier: { contains: q, mode: 'insensitive' } },
        { variant: { name: { contains: q, mode: 'insensitive' } } },
        { variant: { colour: { contains: q, mode: 'insensitive' } } },
        { variant: { model: { name: { contains: q, mode: 'insensitive' } } } },
      ];
    }
    return where;
  }
}
