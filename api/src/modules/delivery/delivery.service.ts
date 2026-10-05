import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DELIVERY_CHECKLIST_ITEMS,
  buildPageMeta,
  type CompleteDeliveryInput,
  type DeliveryChecklistDto,
  type DeliveryDashboardDto,
  type DeliveryDetailDto,
  type DeliveryListRow,
  type ListDeliveriesQuery,
  type Paginated,
  type ScheduleDeliveryInput2,
  type UpdateChecklistInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { BookingsService } from '../sales/bookings.service';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

interface RawRow {
  bookingId: string;
  code: string;
  status: DeliveryListRow['status'];
  customerId: string;
  customerName: string;
  customerPhone: string;
  model: string;
  variant: string;
  vin: string;
  invoiceNumber: string | null;
  expectedDelivery: Date | null;
  actualDelivery: Date | null;
  deliveryExecutive: string | null;
  balance: bigint;
  pendingDocuments: string | null;
}

const detailInclude = {
  customer: { select: { id: true, name: true, phone: true, address: true, city: true } },
  unit: { select: { vin: true, motorNumber: true, batteryNumber: true, variant: { select: { name: true, model: { select: { name: true } } } } } },
  salesExecutive: { select: { name: true } },
  deliveryExecutive: { select: { name: true } },
  payments: { select: { amount: true } },
  sale: {
    select: {
      id: true,
      invoiceNumber: true,
      delivery: { include: { checklist: true, photos: { orderBy: { createdAt: 'asc' } }, deliveredBy: { select: { name: true } } } },
    },
  },
} satisfies Prisma.BookingInclude;
type BookingDetailRow = Prisma.BookingGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly bookings: BookingsService,
    private readonly activityLog: ActivityLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /** The delivery pipeline: active bookings with their computed stage + balance. */
  async list(query: ListDeliveriesQuery): Promise<Paginated<DeliveryListRow>> {
    const company = this.tenant.requireCompanyId();
    const base = this.baseSelect(company);
    const statusFilter = query.status ? Prisma.sql`AND t.status = ${query.status}` : Prisma.empty;
    const q = query.q ? `%${query.q}%` : null;
    const searchFilter = q
      ? Prisma.sql`AND (t.code ILIKE ${q} OR t."customerName" ILIKE ${q} OR t.vin ILIKE ${q} OR t."customerPhone" ILIKE ${q} OR t."invoiceNumber" ILIKE ${q})`
      : Prisma.empty;

    const [rows, countRes] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>`
        SELECT * FROM (${base}) t
        WHERE TRUE ${statusFilter} ${searchFilter}
        ORDER BY (t.status = 'OVERDUE') DESC, (t.status = 'DELIVERED') ASC, t."expectedDelivery" ASC NULLS LAST, t.code
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (${base}) t WHERE TRUE ${statusFilter} ${searchFilter}`,
    ]);
    const total = countRes[0]?.n ?? 0;
    return { data: rows.map((r) => this.toRow(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async dashboard(): Promise<DeliveryDashboardDto> {
    const company = this.tenant.requireCompanyId();
    const base = this.baseSelect(company);
    const rows = await this.prisma.$queryRaw<{ status: string; pending: string | null; delivered: Date | null }[]>`
      SELECT t.status, t."pendingDocuments" AS pending, t."actualDelivery" AS delivered FROM (${base}) t`;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const count = (s: string): number => rows.filter((r) => r.status === s).length;
    return {
      readyToDeliver: count('READY'),
      scheduledToday: rows.filter((r) => r.status === 'SCHEDULED' || r.status === 'OVERDUE').length,
      overdue: count('OVERDUE'),
      awaitingPayment: count('AWAITING_PAYMENT'),
      deliveredThisMonth: rows.filter((r) => r.delivered && r.delivered >= monthStart).length,
      pendingDocuments: rows.filter((r) => r.pending && r.status !== 'DELIVERED').length,
    };
  }

  async detail(bookingId: string): Promise<DeliveryDetailDto> {
    const b = await this.getBookingOrThrow(bookingId);
    return this.toDetail(b);
  }

  async schedule(bookingId: string, dto: ScheduleDeliveryInput2): Promise<DeliveryDetailDto> {
    await this.getBookingOrThrow(bookingId);
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { expectedDelivery: dto.expectedDelivery ?? null, deliveryExecutiveId: dto.deliveryExecutiveId ?? null, pendingDocuments: dto.pendingDocuments ?? null },
    });
    return this.detail(bookingId);
  }

  /** Complete the delivery: reuse the booking's markDelivered core, then capture the handover. */
  async complete(bookingId: string, dto: CompleteDeliveryInput, userId: string): Promise<DeliveryDetailDto> {
    const b = await this.getBookingOrThrow(bookingId);
    if (b.actualDelivery) throw new BadRequestException('This vehicle is already delivered');
    // Delegates all guards (invoice must exist; a partial balance is allowed), the
    // unit → Delivered transition, the Delivery + checklist creation, timeline and
    // audit — no logic duplicated here.
    await this.bookings.markDelivered(bookingId, { actualDelivery: dto.actualDelivery }, userId);

    const delivery = await this.prisma.delivery.findFirst({ where: { sale: { bookingId } }, select: { id: true } });
    if (delivery) {
      // Capture the handover (notes, override reason, checklist) atomically so a
      // failure never leaves a half-recorded handover on an already-delivered unit.
      await this.prisma.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { notes: dto.notes ?? null, overrideReason: dto.overrideReason ?? null, updatedById: userId },
        });
        if (dto.checklist) await this.writeChecklist(delivery.id, dto.checklist, userId, tx);
      });
    }
    return this.detail(bookingId);
  }

  async updateChecklist(bookingId: string, dto: UpdateChecklistInput, userId: string): Promise<DeliveryDetailDto> {
    const delivery = await this.getDeliveryOrThrow(bookingId);
    await this.writeChecklist(delivery.id, dto, userId);
    return this.detail(bookingId);
  }

  async addPhoto(bookingId: string, file: UploadedFile, label: string | undefined, userId: string): Promise<DeliveryDetailDto> {
    const delivery = await this.getDeliveryOrThrow(bookingId);
    const stored = await this.storage.save({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: `deliveries/${delivery.id}` });
    await this.prisma.deliveryPhoto.create({ data: { deliveryId: delivery.id, fileKey: stored.fileKey, label: label ?? null, createdById: userId } });
    return this.detail(bookingId);
  }

  async removePhoto(bookingId: string, photoId: string): Promise<DeliveryDetailDto> {
    const delivery = await this.getDeliveryOrThrow(bookingId);
    const photo = await this.prisma.deliveryPhoto.findFirst({ where: { id: photoId, deliveryId: delivery.id } });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.deliveryPhoto.delete({ where: { id: photoId } });
    await this.storage.remove(photo.fileKey).catch(() => undefined);
    return this.detail(bookingId);
  }

  async setSignature(bookingId: string, file: UploadedFile, userId: string): Promise<DeliveryDetailDto> {
    const delivery = await this.getDeliveryOrThrow(bookingId);
    const stored = await this.storage.save({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: `deliveries/${delivery.id}` });
    await this.prisma.delivery.update({ where: { id: delivery.id }, data: { customerSignatureKey: stored.fileKey, updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Delivery', entityId: delivery.id, summary: 'Captured customer signature' });
    return this.detail(bookingId);
  }

  async notePdfData(bookingId: string): Promise<{ detail: DeliveryDetailDto; code: string; timeZone: string }> {
    const detail = await this.detail(bookingId);
    if (!detail.delivery) throw new BadRequestException('Vehicle has not been delivered yet');
    // The note prints the delivery date as the company's business date, not the server's.
    return { detail, code: detail.booking.code, timeZone: await this.bookings.businessTimeZone() };
  }

  // ── internals ──
  private baseSelect(company: string): Prisma.Sql {
    return Prisma.sql`
      SELECT b.id AS "bookingId", b.code, b."expectedDelivery", b."actualDelivery", b."pendingDocuments",
             c.id AS "customerId", c.name AS "customerName", c.phone AS "customerPhone",
             m.name AS model, v.name AS variant, u.vin,
             de.name AS "deliveryExecutive", s."invoiceNumber",
             (b.total - COALESCE(pp.paid, 0))::bigint AS balance,
             CASE
               WHEN b."actualDelivery" IS NOT NULL THEN 'DELIVERED'
               WHEN (b.total - COALESCE(pp.paid, 0)) > 0 THEN 'AWAITING_PAYMENT'
               WHEN b."expectedDelivery" IS NOT NULL AND b."expectedDelivery" < date_trunc('day', now()) THEN 'OVERDUE'
               WHEN b."expectedDelivery" IS NOT NULL THEN 'SCHEDULED'
               ELSE 'READY'
             END AS status
      FROM "Booking" b
      JOIN "Customer" c ON c.id = b."customerId"
      JOIN "InventoryUnit" u ON u.id = b."unitId"
      JOIN "ScooterVariant" v ON v.id = u."variantId"
      JOIN "ScooterModel" m ON m.id = v."modelId"
      LEFT JOIN "User" de ON de.id = b."deliveryExecutiveId"
      LEFT JOIN "Sale" s ON s."bookingId" = b.id
      LEFT JOIN (SELECT "bookingId", SUM(amount) AS paid FROM "Payment" WHERE "bookingId" IS NOT NULL GROUP BY "bookingId") pp ON pp."bookingId" = b.id
      WHERE b."deletedAt" IS NULL AND b."companyId" = ${company} AND b.status IN ('CONFIRMED', 'CONVERTED')`;
  }

  private async writeChecklist(deliveryId: string, dto: Partial<DeliveryChecklistDto>, userId: string, db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<void> {
    const data: Record<string, boolean | string> = { updatedById: userId };
    for (const key of DELIVERY_CHECKLIST_ITEMS) if (dto[key] !== undefined) data[key] = dto[key] as boolean;
    await db.deliveryChecklist.update({ where: { deliveryId }, data });
  }

  private async getBookingOrThrow(bookingId: string): Promise<BookingDetailRow> {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId }, include: detailInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async getDeliveryOrThrow(bookingId: string): Promise<{ id: string }> {
    const delivery = await this.prisma.delivery.findFirst({ where: { sale: { bookingId } }, select: { id: true } });
    if (!delivery) throw new BadRequestException('Vehicle has not been delivered yet');
    return delivery;
  }

  private computeStatus(b: BookingDetailRow, balance: bigint): DeliveryListRow['status'] {
    if (b.actualDelivery) return 'DELIVERED';
    if (balance > 0n) return 'AWAITING_PAYMENT';
    if (b.expectedDelivery && b.expectedDelivery < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) return 'OVERDUE';
    if (b.expectedDelivery) return 'SCHEDULED';
    return 'READY';
  }

  private toRow(r: RawRow): DeliveryListRow {
    return {
      bookingId: r.bookingId,
      code: r.code,
      status: r.status,
      customerId: r.customerId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      model: r.model,
      variant: r.variant,
      vin: r.vin,
      invoiceNumber: r.invoiceNumber,
      expectedDelivery: r.expectedDelivery ? new Date(r.expectedDelivery).toISOString() : null,
      actualDelivery: r.actualDelivery ? new Date(r.actualDelivery).toISOString() : null,
      deliveryExecutive: r.deliveryExecutive,
      balance: String(r.balance),
      pendingDocuments: r.pendingDocuments,
    };
  }

  private toDetail(b: BookingDetailRow): DeliveryDetailDto {
    const paid = b.payments.reduce<bigint>((a, p) => a + p.amount, 0n);
    const balance = b.total - paid;
    const d = b.sale?.delivery ?? null;
    const checklist = Object.fromEntries(DELIVERY_CHECKLIST_ITEMS.map((k) => [k, d?.checklist?.[k] ?? false])) as DeliveryChecklistDto;
    return {
      booking: {
        bookingId: b.id,
        code: b.code,
        status: this.computeStatus(b, balance),
        customerId: b.customer.id,
        customerName: b.customer.name,
        customerPhone: b.customer.phone,
        address: b.customer.address,
        city: b.customer.city,
        model: b.unit.variant.model.name,
        variant: b.unit.variant.name,
        vin: b.unit.vin,
        motorNumber: b.unit.motorNumber,
        batteryNumber: b.unit.batteryNumber,
        invoiceNumber: b.sale?.invoiceNumber ?? null,
        expectedDelivery: b.expectedDelivery?.toISOString() ?? null,
        actualDelivery: b.actualDelivery?.toISOString() ?? null,
        deliveryExecutive: b.deliveryExecutive?.name ?? null,
        salesExecutive: b.salesExecutive?.name ?? null,
        balance: String(balance),
        total: String(b.total),
        paid: String(paid),
        pendingDocuments: b.pendingDocuments,
      },
      delivery: d
        ? {
            id: d.id,
            deliveredAt: d.deliveredAt.toISOString(),
            deliveredBy: d.deliveredBy?.name ?? null,
            notes: d.notes,
            overrideReason: d.overrideReason,
            signatureUrl: d.customerSignatureKey ? this.storage.urlFor(d.customerSignatureKey) : null,
            googleReviewSent: d.googleReviewSent,
            checklist,
            photos: d.photos.map((p) => ({ id: p.id, url: this.storage.urlFor(p.fileKey), label: p.label, createdAt: p.createdAt.toISOString() })),
          }
        : null,
    };
  }
}
