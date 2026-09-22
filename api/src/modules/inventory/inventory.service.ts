import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { ZodError } from 'zod';
import {
  ActivityAction,
  UnitStatus,
  UNIT_STATUSES,
  buildPageMeta,
  canTransitionUnit,
  csvUnitRowSchema,
  type CreateUnitInput,
  type CsvImportResult,
  type ChangeUnitStatusInput,
  type ListUnitsQuery,
  type Paginated,
  type UpdateUnitInput,
} from '@azad/shared';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { ExportService, type ExportData } from '../../export/export.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { rupeesToPaise, formatInr } from '../../common/utils/money';
import { InventoryRepository } from './inventory.repository';

const LOW_STOCK_THRESHOLD = 2;
// High enough to export a whole dealership's stock in one file; a single
// showroom never approaches this, but exports must not silently truncate.
const EXPORT_CAP = 100_000;

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly activityLog: ActivityLogService,
    private readonly exporter: ExportService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
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
    return {
      ...unit,
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
    const unit = await this.repo.transaction(async (tx) => {
      const variant = await this.resolveVariant(
        tx,
        dto.modelId,
        dto.variant,
        dto.colour,
        dto.hexColour,
        BigInt(dto.sellingPrice),
      );
      const created = await this.repo.createUnit(
        {
          variant: { connect: { id: variant.id } },
          vin: dto.vin,
          motorNumber: dto.motorNumber,
          batteryNumber: dto.batteryNumber,
          status: dto.status,
          purchaseDate: dto.purchaseDate ?? null,
          purchaseCost: BigInt(dto.purchaseCost),
          sellingPrice: BigInt(dto.sellingPrice),
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
    if (dto.vin && dto.vin !== existing.vin) {
      await this.assertVinAvailable(dto.vin);
    }

    const unit = await this.repo.transaction(async (tx) => {
      const data: Prisma.InventoryUnitUpdateInput = { updatedById: userId };

      if (dto.modelId !== undefined || dto.variant !== undefined || dto.colour !== undefined) {
        const variant = await this.resolveVariant(
          tx,
          dto.modelId ?? existing.variant.modelId,
          dto.variant ?? existing.variant.name,
          dto.colour ?? existing.variant.colour,
          dto.hexColour ?? existing.variant.hexColour ?? undefined,
          dto.sellingPrice !== undefined ? BigInt(dto.sellingPrice) : existing.variant.exShowroomPrice,
        );
        data.variant = { connect: { id: variant.id } };
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

    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'InventoryUnit',
      entityId: id,
      summary: `Updated scooter ${unit.vin}`,
    });
    return unit;
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

  // ── Bulk CSV import ────────────────────────────────────
  async importCsv(file: UploadedFile, userId: string): Promise<CsvImportResult> {
    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: (header: string[]) => header.map((h) => this.normalizeHeader(h)),
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('Could not parse the CSV file');
    }

    const result: CsvImportResult = { created: 0, failed: 0, errors: [] };
    for (let i = 0; i < records.length; i += 1) {
      const rowNumber = i + 2; // account for header row
      try {
        const row = csvUnitRowSchema.parse(records[i]);
        const status = this.normalizeStatus(row.status);
        await this.repo.transaction(async (tx) => {
          const model = await this.resolveModelByName(tx, row.model);
          const variant = await this.resolveVariant(
            tx,
            model.id,
            row.variant,
            row.colour,
            undefined,
            rupeesToPaise(row.sellingPrice),
          );
          const unit = await this.repo.createUnit(
            {
              variant: { connect: { id: variant.id } },
              vin: row.vin,
              motorNumber: row.motorNumber,
              batteryNumber: row.batteryNumber,
              status,
              purchaseDate: row.purchaseDate ? new Date(row.purchaseDate) : null,
              purchaseCost: rupeesToPaise(row.purchaseCost),
              sellingPrice: rupeesToPaise(row.sellingPrice),
              supplier: row.supplier ?? null,
              location: row.location ?? null,
              createdById: userId,
              updatedById: userId,
            },
            tx,
          );
          await this.repo.addEvent(
            {
              unitId: unit.id,
              fromStatus: null,
              toStatus: status,
              note: 'Imported via CSV',
              createdById: userId,
            },
            tx,
          );
        });
        result.created += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: this.humanizeError(error) });
      }
    }

    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.CREATE,
      entityType: 'InventoryUnit',
      summary: `CSV import: ${result.created} added, ${result.failed} failed`,
      metadata: { created: result.created, failed: result.failed },
    });
    return result;
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
  listModels() {
    return this.repo.findModels();
  }

  listVariants(modelId?: string) {
    return this.repo.findVariants(modelId);
  }

  async createModel(name: string, brand: string, userId: string) {
    const existing = await this.repo.findModelByName(name);
    if (existing) throw new ConflictException(`Model "${name}" already exists`);
    return this.repo.createModel({ name, brand, createdById: userId, updatedById: userId });
  }

  // ── Helpers ────────────────────────────────────────────
  private async getUnitOrThrow(id: string) {
    const unit = await this.repo.findByIdWithVariant(id);
    if (!unit) throw new NotFoundException('Scooter not found');
    return unit;
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

  private async resolveModelByName(tx: Prisma.TransactionClient, name: string) {
    const existing = await this.repo.findModelByName(name);
    if (existing) return existing;
    return this.repo.createModel({ name, brand: 'Comptech' }, tx);
  }

  private normalizeStatus(raw: string | undefined): UnitStatus {
    if (!raw) return UnitStatus.AVAILABLE;
    const upper = raw.toUpperCase().replace(/\s+/g, '_');
    if ((UNIT_STATUSES as string[]).includes(upper)) return upper as UnitStatus;
    throw new BadRequestException(`Unknown status "${raw}"`);
  }

  private normalizeHeader(header: string): string {
    const key = header.toLowerCase().replace(/[\s_-]+/g, '');
    const map: Record<string, string> = {
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

  private humanizeError(error: unknown): string {
    if (error instanceof ZodError) {
      return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ');
      return `Duplicate ${target ?? 'value'}`;
    }
    if (error instanceof BadRequestException) {
      const res = error.getResponse();
      return typeof res === 'string' ? res : (res as { message?: string }).message ?? 'Invalid row';
    }
    return error instanceof Error ? error.message : 'Invalid row';
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
