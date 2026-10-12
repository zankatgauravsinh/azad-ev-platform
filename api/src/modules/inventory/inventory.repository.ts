import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UnitStatus } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  readonly unitInclude = {
    variant: { include: { model: true } },
  } satisfies Prisma.InventoryUnitInclude;

  // ── Units ──────────────────────────────────────────────
  findMany(args: {
    where: Prisma.InventoryUnitWhereInput;
    orderBy: Prisma.InventoryUnitOrderByWithRelationInput;
    skip: number;
    take: number;
  }) {
    return this.prisma.inventoryUnit.findMany({ ...args, include: this.unitInclude });
  }

  count(where: Prisma.InventoryUnitWhereInput): Promise<number> {
    return this.prisma.inventoryUnit.count({ where });
  }

  findByVin(vin: string) {
    return this.prisma.inventoryUnit.findUnique({ where: { vin } });
  }

  findByIdWithVariant(id: string) {
    return this.prisma.inventoryUnit.findFirst({ where: { id }, include: this.unitInclude });
  }

  /** A live (confirmed/invoiced, not yet delivered) booking holding this unit, if any. */
  activeBooking(unitId: string) {
    return this.prisma.booking.findFirst({
      where: { unitId, status: { in: ['CONFIRMED', 'CONVERTED'] }, actualDelivery: null },
      select: { id: true, code: true },
    });
  }

  findDetail(id: string) {
    return this.prisma.inventoryUnit.findFirst({
      where: { id },
      include: {
        variant: { include: { model: true } },
        events: { orderBy: { createdAt: 'asc' } },
        photos: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        bookings: {
          orderBy: { createdAt: 'desc' },
          include: { customer: { select: { id: true, name: true, phone: true } } },
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          include: { customer: { select: { id: true, name: true, phone: true } } },
        },
        serviceJobs: {
          orderBy: { createdAt: 'desc' },
          include: { customer: { select: { id: true, name: true, phone: true } } },
        },
      },
    });
  }

  createUnit(data: Prisma.InventoryUnitCreateInput, db: Db = this.prisma) {
    return db.inventoryUnit.create({ data, include: this.unitInclude });
  }

  updateUnit(id: string, data: Prisma.InventoryUnitUpdateInput, db: Db = this.prisma) {
    return db.inventoryUnit.update({ where: { id }, data, include: this.unitInclude });
  }

  softDelete(id: string) {
    // PrismaService middleware rewrites delete → set deletedAt.
    return this.prisma.inventoryUnit.delete({ where: { id } });
  }

  async stats(): Promise<Record<UnitStatus, number> & { total: number }> {
    const grouped = await this.prisma.inventoryUnit.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const base = {
      AVAILABLE: 0,
      RESERVED: 0,
      BOOKED: 0,
      DELIVERED: 0,
      IN_SERVICE: 0,
      RETURNED: 0,
    } as Record<UnitStatus, number>;
    let total = 0;
    for (const g of grouped) {
      base[g.status as UnitStatus] = g._count._all;
      total += g._count._all;
    }
    return { ...base, total };
  }

  recentlyAdded(take: number) {
    return this.prisma.inventoryUnit.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: this.unitInclude,
    });
  }

  findByStatus(status: UnitStatus, take: number) {
    return this.prisma.inventoryUnit.findMany({
      where: { status },
      orderBy: { updatedAt: 'desc' },
      take,
      include: this.unitInclude,
    });
  }

  // ── Models & variants ──────────────────────────────────
  findModels() {
    return this.prisma.scooterModel.findMany({
      where: { isActive: true },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });
  }

  findVariants(modelId?: string) {
    return this.prisma.scooterVariant.findMany({
      where: { isActive: true, ...(modelId ? { modelId } : {}) },
      orderBy: [{ name: 'asc' }, { colour: 'asc' }],
      include: { model: { select: { id: true, name: true, brand: true } } },
    });
  }

  findModelById(id: string) {
    return this.prisma.scooterModel.findUnique({ where: { id } });
  }

  findModelByName(name: string) {
    return this.prisma.scooterModel.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  createModel(data: Prisma.ScooterModelCreateInput, db: Db = this.prisma) {
    return db.scooterModel.create({ data });
  }

  findVariant(modelId: string, name: string, colour: string, db: Db = this.prisma) {
    return db.scooterVariant.findUnique({
      where: { modelId_name_colour: { modelId, name, colour } },
    });
  }

  createVariant(data: Prisma.ScooterVariantCreateInput, db: Db = this.prisma) {
    return db.scooterVariant.create({ data });
  }

  // ── Events (append-only history) ───────────────────────
  addEvent(data: Prisma.InventoryEventUncheckedCreateInput, db: Db = this.prisma) {
    return db.inventoryEvent.create({ data });
  }

  findEvents(unitId: string) {
    return this.prisma.inventoryEvent.findMany({
      where: { unitId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Photos ─────────────────────────────────────────────
  addPhoto(data: Prisma.InventoryUnitPhotoUncheckedCreateInput) {
    return this.prisma.inventoryUnitPhoto.create({ data });
  }
  listPhotos(unitId: string) {
    return this.prisma.inventoryUnitPhoto.findMany({
      where: { unitId },
      orderBy: { createdAt: 'desc' },
    });
  }
  findPhoto(id: string) {
    return this.prisma.inventoryUnitPhoto.findUnique({ where: { id } });
  }
  deletePhoto(id: string) {
    return this.prisma.inventoryUnitPhoto.delete({ where: { id } });
  }

  // ── Documents ──────────────────────────────────────────
  addDocument(data: Prisma.InventoryUnitDocumentUncheckedCreateInput) {
    return this.prisma.inventoryUnitDocument.create({ data });
  }
  listDocuments(unitId: string) {
    return this.prisma.inventoryUnitDocument.findMany({
      where: { unitId },
      orderBy: { createdAt: 'desc' },
    });
  }
  findDocument(id: string) {
    return this.prisma.inventoryUnitDocument.findUnique({ where: { id } });
  }
  deleteDocument(id: string) {
    return this.prisma.inventoryUnitDocument.delete({ where: { id } });
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T> {
    return options ? this.prisma.$transaction(fn, options) : this.prisma.$transaction(fn);
  }

  // ── CSV import (M4D.3) ─────────────────────────────────
  /** Bulk insert (ids supplied by the caller so their history events can reference them). */
  async createUnits(data: Prisma.InventoryUnitCreateManyInput[], tx: Prisma.TransactionClient): Promise<number> {
    const { count } = await tx.inventoryUnit.createMany({ data });
    return count;
  }

  async addEvents(data: Prisma.InventoryEventCreateManyInput[], tx: Prisma.TransactionClient): Promise<number> {
    const { count } = await tx.inventoryEvent.createMany({ data });
    return count;
  }

  /**
   * Share-locks the company's catalogue rows an import uses — models first, then variants, each in id
   * order (the M4B.5 rename takes model then variants too, so the two cannot deadlock). Deactivating or
   * renaming them now waits until the import commits; creating units in them is unaffected. Returns the
   * ids actually locked (a row that is not this company's, or no longer exists, is not among them).
   */
  async lockCatalogueRows(companyId: string, modelIds: string[], variantIds: string[], tx: Prisma.TransactionClient): Promise<{ modelIds: Set<string>; variantIds: Set<string> }> {
    const models = modelIds.length > 0
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ScooterModel" WHERE "companyId" = ${companyId} AND id IN (${Prisma.join(modelIds)}) ORDER BY id FOR SHARE`
      : [];
    const variants = variantIds.length > 0
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ScooterVariant" WHERE "companyId" = ${companyId} AND id IN (${Prisma.join(variantIds)}) ORDER BY id FOR SHARE`
      : [];
    return { modelIds: new Set(models.map((m) => m.id)), variantIds: new Set(variants.map((v) => v.id)) };
  }

  /**
   * M4D.2 / M4D.3 — which of these VIN / motor / battery numbers are already used by ANY scooter,
   * soft-deleted included. The numbers are unique across the whole system (not per company), so one used
   * elsewhere would still make the import fail. Per value only two facts come back: whether the user's own
   * company holds it (and whether that scooter is deleted) — never the scooter or another company. Raw SQL
   * on purpose: the tenant and soft-delete filters must not apply.
   */
  async findUsedIdentifiers(
    values: { vin: string[]; motorNumber: string[]; batteryNumber: string[] },
    companyId: string,
    db: Db = this.prisma,
  ): Promise<Record<'vin' | 'motorNumber' | 'batteryNumber', Map<string, { own: boolean; deleted: boolean }>>> {
    const used = { vin: new Map<string, { own: boolean; deleted: boolean }>(), motorNumber: new Map<string, { own: boolean; deleted: boolean }>(), batteryNumber: new Map<string, { own: boolean; deleted: boolean }>() };
    if (values.vin.length + values.motorNumber.length + values.batteryNumber.length === 0) return used;
    const rows = await db.$queryRaw<{ vin: string; motorNumber: string; batteryNumber: string; own: boolean; deleted: boolean }[]>`
      SELECT vin, "motorNumber", "batteryNumber", ("companyId" = ${companyId}) AS own, ("deletedAt" IS NOT NULL) AS deleted
      FROM "InventoryUnit"
      WHERE vin = ANY(${values.vin}::text[]) OR "motorNumber" = ANY(${values.motorNumber}::text[]) OR "batteryNumber" = ANY(${values.batteryNumber}::text[])`;
    const wanted = { vin: new Set(values.vin), motorNumber: new Set(values.motorNumber), batteryNumber: new Set(values.batteryNumber) };
    for (const row of rows) {
      for (const field of ['vin', 'motorNumber', 'batteryNumber'] as const) {
        if (wanted[field].has(row[field])) used[field].set(row[field], { own: row.own === true, deleted: row.deleted === true });
      }
    }
    return used;
  }

  // ── Identity protection (M4B.4) ────────────────────────
  /**
   * Locks the unit's row (FOR UPDATE) for the rest of the transaction and returns its current status and
   * identity. Creating a Sale (invoice), Warranty or AMC plan inserts a row whose foreign key references
   * this unit, and Postgres takes a KEY SHARE lock on the unit for that insert until its transaction ends.
   * FOR UPDATE conflicts with KEY SHARE, so after this lock a history check sees every such record that
   * was being created, and none can be created until this transaction ends.
   */
  async lockUnit(companyId: string, id: string, tx: Prisma.TransactionClient): Promise<LockedUnit | null> {
    const rows = await tx.$queryRaw<LockedUnit[]>`
      SELECT id, status::text AS status, vin, "motorNumber", "batteryNumber", "variantId"
      FROM "InventoryUnit"
      WHERE id = ${id} AND "companyId" = ${companyId} AND "deletedAt" IS NULL
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Whether the unit has entered committed business history: any Sale (soft-deleted included), any
   * Warranty (cancelled included) or any AMC plan (cancelled included). Completed returns and deliveries
   * always belong to a Sale; a service job alone does not count. Raw SQL on purpose, so the soft-delete
   * filter cannot hide a Sale. The caller has already resolved the unit within its company.
   */
  async hasCommittedHistory(id: string, db: Db = this.prisma): Promise<boolean> {
    const [row] = await db.$queryRaw<{ committed: boolean }[]>`
      SELECT (EXISTS (SELECT 1 FROM "Sale" WHERE "unitId" = ${id})
           OR EXISTS (SELECT 1 FROM "Warranty" WHERE "unitId" = ${id})
           OR EXISTS (SELECT 1 FROM "AmcPlan" WHERE "unitId" = ${id})) AS committed`;
    return row?.committed === true;
  }
}

export interface LockedUnit {
  id: string;
  status: UnitStatus;
  vin: string;
  motorNumber: string;
  batteryNumber: string;
  variantId: string;
}
