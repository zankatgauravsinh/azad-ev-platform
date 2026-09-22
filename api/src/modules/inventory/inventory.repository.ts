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

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
