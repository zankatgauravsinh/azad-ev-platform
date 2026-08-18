import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationType,
  NotificationPriority,
  buildPageMeta,
  type CreateNotificationInput,
  type ListNotificationsQuery,
  type NotificationDto,
  type Paginated,
  type UnreadCount,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { formatInr } from '../../common/utils/money';
import { CashbookService } from '../finance/cashbook.service';

type Notification = Prisma.NotificationGetPayload<Record<string, never>>;

/** A candidate auto-generated notification (before de-duplication). */
interface Candidate {
  dedupeKey: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly cashbook: CashbookService,
  ) {}

  // ── Reads ──────────────────────────────────────────────
  async list(query: ListNotificationsQuery): Promise<Paginated<NotificationDto>> {
    const where = this.buildWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.notification.count({ where }),
    ]);
    return { data: rows.map((n) => this.toDto(n)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async unreadCount(): Promise<UnreadCount> {
    const total = await this.prisma.notification.count({
      where: { readAt: null, archivedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return { total };
  }

  private buildWhere(query: ListNotificationsQuery): Prisma.NotificationWhereInput {
    const where: Prisma.NotificationWhereInput = {
      archivedAt: query.archived === 'true' ? { not: null } : null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.unread !== undefined) where.readAt = query.unread === 'true' ? null : { not: null };
    if (query.from || query.to) where.createdAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.AND = [{ OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { message: { contains: query.q, mode: 'insensitive' } }] }];
    }
    return where;
  }

  // ── Mutations ──────────────────────────────────────────
  async create(dto: CreateNotificationInput, userId: string): Promise<NotificationDto> {
    const created = await this.prisma.notification.create({
      data: {
        companyId: this.tenant.requireCompanyId(),
        title: dto.title,
        message: dto.message,
        type: dto.type,
        priority: dto.priority,
        entityType: dto.entityType ?? null,
        entityId: dto.entityId ?? null,
        expiresAt: dto.expiresAt ?? null,
        createdById: userId,
      },
    });
    return this.toDto(created);
  }

  async markRead(id: string): Promise<NotificationDto> {
    await this.getOrThrow(id);
    const updated = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return this.toDto(updated);
  }

  async markAllRead(): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({ where: { readAt: null, archivedAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  async archive(id: string): Promise<NotificationDto> {
    await this.getOrThrow(id);
    const updated = await this.prisma.notification.update({ where: { id }, data: { archivedAt: new Date(), readAt: new Date() } });
    return this.toDto(updated);
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.notification.delete({ where: { id } });
  }

  private async getOrThrow(id: string): Promise<Notification> {
    const found = await this.prisma.notification.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Notification not found');
    return found;
  }

  // ── Auto-generation ────────────────────────────────────
  /**
   * Scans the dealership for actionable conditions and creates notifications,
   * de-duplicated by a stable key so repeated refreshes never pile up. Safe to
   * call from a request or, later, a scheduled job / queue — same seam.
   */
  async generate(): Promise<{ created: number }> {
    const company = this.tenant.requireCompanyId();
    const settings = await this.prisma.companySetting.findFirst();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    const candidates: Candidate[] = [];

    if (settings?.notifyDelivery ?? true) await this.deliveryCandidates(todayStart, todayEnd, candidates);
    if (settings?.notifyPayment ?? true) await this.paymentCandidates(company, candidates);
    if (settings?.notifyService ?? true) {
      await this.serviceCandidates(todayStart, todayEnd, candidates);
      await this.freeServiceCandidates(now, candidates);
    }
    if (settings?.notifyWarranty ?? true) {
      await this.warrantyCandidates(now, candidates);
      if (settings?.amcEnabled ?? true) await this.amcCandidates(now, candidates);
    }
    if (settings?.notifyInventory ?? true) await this.inventoryCandidates(company, candidates);
    if ((settings?.notifyPayment ?? true) && (settings?.financeEnabled ?? true)) {
      await this.financeCandidates(now, settings?.lowCashThreshold ?? 0n, candidates);
    }
    await this.followUpCandidates(todayStart, todayEnd, candidates);

    if (candidates.length === 0) return { created: 0 };
    const existing = await this.prisma.notification.findMany({
      where: { dedupeKey: { in: candidates.map((c) => c.dedupeKey) } },
      select: { dedupeKey: true },
    });
    const have = new Set(existing.map((e) => e.dedupeKey));
    const fresh = candidates.filter((c) => !have.has(c.dedupeKey));
    if (fresh.length > 0) {
      await this.prisma.notification.createMany({ data: fresh.map((c) => ({ ...c, companyId: company })) });
    }
    return { created: fresh.length };
  }

  private async deliveryCandidates(todayStart: Date, todayEnd: Date, out: Candidate[]): Promise<void> {
    const bookings = await this.prisma.booking.findMany({
      where: { status: { not: 'CANCELLED' }, actualDelivery: null, OR: [{ expectedDelivery: { lt: todayEnd } }, { pendingDocuments: { not: null } }] },
      select: { id: true, code: true, expectedDelivery: true, pendingDocuments: true, customer: { select: { name: true } } },
      take: 300,
    });
    for (const b of bookings) {
      if (b.expectedDelivery && b.expectedDelivery < todayStart) {
        out.push({ dedupeKey: `delivery-overdue:${b.id}`, type: NotificationType.DELIVERY, priority: NotificationPriority.CRITICAL, title: 'Delivery overdue', message: `${b.code} · ${b.customer.name} — was due ${b.expectedDelivery.toLocaleDateString('en-IN')}`, entityType: 'Booking', entityId: b.id });
      } else if (b.expectedDelivery && b.expectedDelivery >= todayStart && b.expectedDelivery < todayEnd) {
        out.push({ dedupeKey: `delivery-today:${b.id}`, type: NotificationType.DELIVERY, priority: NotificationPriority.HIGH, title: 'Delivery due today', message: `${b.code} · ${b.customer.name}`, entityType: 'Booking', entityId: b.id });
      }
      if (b.pendingDocuments) {
        out.push({ dedupeKey: `delivery-docs:${b.id}`, type: NotificationType.DELIVERY, priority: NotificationPriority.MEDIUM, title: 'Pending documents', message: `${b.code} · ${b.customer.name} — ${b.pendingDocuments}`, entityType: 'Booking', entityId: b.id });
      }
    }
  }

  private async paymentCandidates(company: string, out: Candidate[]): Promise<void> {
    const balances = await this.prisma.$queryRaw<{ id: string; code: string; name: string; balance: bigint }[]>`
      SELECT b.id, b.code, c.name, (b.total - COALESCE(p.paid, 0))::bigint AS balance
      FROM "Booking" b JOIN "Customer" c ON c.id = b."customerId"
      LEFT JOIN (SELECT "bookingId", SUM(amount) AS paid FROM "Payment" WHERE "bookingId" IS NOT NULL GROUP BY "bookingId") p ON p."bookingId" = b.id
      WHERE b."deletedAt" IS NULL AND b.status <> 'CANCELLED' AND b."companyId" = ${company} AND b.total > COALESCE(p.paid, 0)
      ORDER BY balance DESC LIMIT 300`;
    for (const b of balances) {
      out.push({ dedupeKey: `payment-outstanding:${b.id}`, type: NotificationType.PAYMENT, priority: NotificationPriority.HIGH, title: 'Outstanding payment', message: `${b.code} · ${b.name} — ${formatInr(b.balance)} pending`, entityType: 'Booking', entityId: b.id });
    }
  }

  private async serviceCandidates(todayStart: Date, todayEnd: Date, out: Candidate[]): Promise<void> {
    const jobs = await this.prisma.serviceJob.findMany({
      where: { status: { notIn: ['DELIVERED', 'CANCELLED'] }, scheduledDate: { lt: todayEnd } },
      select: { id: true, code: true, scheduledDate: true, customer: { select: { name: true } } },
      take: 300,
    });
    for (const j of jobs) {
      if (j.scheduledDate && j.scheduledDate < todayStart) {
        out.push({ dedupeKey: `service-overdue:${j.id}`, type: NotificationType.SERVICE, priority: NotificationPriority.HIGH, title: 'Service overdue', message: `${j.code} · ${j.customer.name}`, entityType: 'ServiceJob', entityId: j.id });
      } else {
        out.push({ dedupeKey: `service-today:${j.id}`, type: NotificationType.SERVICE, priority: NotificationPriority.MEDIUM, title: 'Service due today', message: `${j.code} · ${j.customer.name}`, entityType: 'ServiceJob', entityId: j.id });
      }
    }
  }

  private async warrantyCandidates(now: Date, out: Candidate[]): Promise<void> {
    const horizon = new Date(now.getTime() + 90 * 86_400_000);
    const rows = await this.prisma.warranty.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRED'] }, endDate: { lte: horizon } },
      select: { id: true, warrantyNumber: true, endDate: true, customer: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
      take: 300,
    });
    for (const w of rows) {
      const days = Math.ceil((w.endDate.getTime() - now.getTime()) / 86_400_000);
      const bucket = days < 0 ? 'expired' : days <= 7 ? '7d' : days <= 30 ? '30d' : days <= 60 ? '60d' : '90d';
      const priority = days < 0 || days <= 7 ? NotificationPriority.HIGH : days <= 30 ? NotificationPriority.MEDIUM : NotificationPriority.LOW;
      out.push({ dedupeKey: `warranty-${bucket}:${w.id}`, type: NotificationType.WARRANTY, priority, title: days < 0 ? 'Warranty expired' : 'Warranty expiring', message: `${w.warrantyNumber} · ${w.customer.name} — ${days < 0 ? 'expired' : `${days} day(s) left`}`, entityType: 'Warranty', entityId: w.id });
    }
  }

  private async amcCandidates(now: Date, out: Candidate[]): Promise<void> {
    const horizon = new Date(now.getTime() + 30 * 86_400_000);
    const rows = await this.prisma.amcPlan.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, amcNumber: true, endDate: true, visitsIncluded: true, visitsUsed: true, customer: { select: { name: true } } },
      take: 300,
    });
    for (const a of rows) {
      const days = Math.ceil((a.endDate.getTime() - now.getTime()) / 86_400_000);
      if (a.endDate <= horizon) {
        out.push({ dedupeKey: `amc-expiring:${a.id}`, type: NotificationType.WARRANTY, priority: days <= 7 ? NotificationPriority.HIGH : NotificationPriority.MEDIUM, title: 'AMC expiring', message: `${a.amcNumber} · ${a.customer.name} — ${days < 0 ? 'expired' : `${days} day(s) left`}`, entityType: 'AmcPlan', entityId: a.id });
      }
      if (a.visitsUsed >= a.visitsIncluded) {
        out.push({ dedupeKey: `amc-exhausted:${a.id}`, type: NotificationType.WARRANTY, priority: NotificationPriority.MEDIUM, title: 'AMC visits exhausted', message: `${a.amcNumber} · ${a.customer.name} — all ${a.visitsIncluded} visits used`, entityType: 'AmcPlan', entityId: a.id });
      }
    }
  }

  private async freeServiceCandidates(now: Date, out: Candidate[]): Promise<void> {
    const horizon = new Date(now.getTime() + 7 * 86_400_000);
    const rows = await this.prisma.freeService.findMany({
      where: { status: 'PENDING', dueDate: { lte: horizon } },
      select: { id: true, serviceNumber: true, dueDate: true, warranty: { select: { warrantyNumber: true, customer: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' },
      take: 300,
    });
    for (const f of rows) {
      const days = Math.ceil((f.dueDate.getTime() - now.getTime()) / 86_400_000);
      out.push({ dedupeKey: `free-service:${f.id}`, type: NotificationType.SERVICE, priority: days < 0 ? NotificationPriority.HIGH : NotificationPriority.MEDIUM, title: 'Free service due', message: `${f.warranty.warrantyNumber} · ${f.warranty.customer.name} — service #${f.serviceNumber} ${days < 0 ? 'overdue' : `due in ${days} day(s)`}`, entityType: 'FreeService', entityId: f.id });
    }
  }

  private async inventoryCandidates(company: string, out: Candidate[]): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ variantId: string; model: string; variant: string; colour: string; available: number }[]>`
      SELECT u."variantId" AS "variantId", m.name AS model, v.name AS variant, v.colour AS colour,
             COUNT(*) FILTER (WHERE u.status = 'AVAILABLE')::int AS available
      FROM "InventoryUnit" u JOIN "ScooterVariant" v ON v.id = u."variantId" JOIN "ScooterModel" m ON m.id = v."modelId"
      WHERE u."deletedAt" IS NULL AND u."companyId" = ${company}
      GROUP BY u."variantId", m.name, v.name, v.colour
      HAVING COUNT(*) FILTER (WHERE u.status = 'AVAILABLE') <= 2 ORDER BY available ASC LIMIT 50`;
    for (const l of rows) {
      out.push({ dedupeKey: `inventory-low:${l.variantId}`, type: NotificationType.INVENTORY, priority: l.available === 0 ? NotificationPriority.HIGH : NotificationPriority.MEDIUM, title: l.available === 0 ? 'Out of stock' : 'Low stock', message: `${l.model} ${l.variant} · ${l.colour} — ${l.available} available`, entityType: 'ScooterVariant', entityId: l.variantId });
    }
  }

  private async financeCandidates(now: Date, lowCashThreshold: bigint, out: Candidate[]): Promise<void> {
    // Vendor payments due / overdue (unpaid approved expenses with a due date).
    const horizon = new Date(now.getTime() + 7 * 86_400_000);
    const dues = await this.prisma.expense.findMany({
      where: { status: 'APPROVED', paid: false, dueDate: { not: null, lte: horizon } },
      select: { id: true, expenseNumber: true, amount: true, gstAmount: true, dueDate: true, vendor: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });
    for (const e of dues) {
      const overdue = e.dueDate! < now;
      out.push({
        dedupeKey: `vendor-payment-due:${e.id}`,
        type: NotificationType.PAYMENT,
        priority: overdue ? NotificationPriority.HIGH : NotificationPriority.MEDIUM,
        title: overdue ? 'Vendor payment overdue' : 'Vendor payment due',
        message: `${e.expenseNumber} · ${e.vendor?.name ?? 'Vendor'} — ${formatInr(e.amount + e.gstAmount)}`,
        entityType: 'Expense',
        entityId: e.id,
      });
    }
    // Cash balance alerts (dedupe per day so they resurface each day the condition holds).
    const cash = await this.cashbook.cashInHand();
    const day = now.toISOString().slice(0, 10);
    if (cash < 0n) {
      out.push({ dedupeKey: `finance-negative-cash:${day}`, type: NotificationType.PAYMENT, priority: NotificationPriority.CRITICAL, title: 'Cash balance is negative', message: `Cash in hand is ${formatInr(cash)} — review the cash book`, entityType: 'CashBook', entityId: day });
    } else if (cash < lowCashThreshold) {
      out.push({ dedupeKey: `finance-low-cash:${day}`, type: NotificationType.PAYMENT, priority: NotificationPriority.MEDIUM, title: 'Low cash balance', message: `Cash in hand is ${formatInr(cash)}`, entityType: 'CashBook', entityId: day });
    }
  }

  private async followUpCandidates(todayStart: Date, todayEnd: Date, out: Candidate[]): Promise<void> {
    const followUps = await this.prisma.customerFollowUp.findMany({
      where: { status: 'PENDING', dueAt: { gte: todayStart, lt: todayEnd } },
      select: { id: true, note: true, customer: { select: { name: true } } },
      take: 300,
    });
    for (const f of followUps) {
      out.push({ dedupeKey: `followup:${f.id}`, type: NotificationType.CUSTOMER, priority: NotificationPriority.MEDIUM, title: 'Customer follow-up due', message: `${f.customer.name}${f.note ? ` — ${f.note}` : ''}`, entityType: 'CustomerFollowUp', entityId: f.id });
    }
  }

  private toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type as NotificationType,
      priority: n.priority as NotificationPriority,
      entityType: n.entityType,
      entityId: n.entityId,
      isRead: n.readAt !== null,
      readAt: n.readAt?.toISOString() ?? null,
      archivedAt: n.archivedAt?.toISOString() ?? null,
      expiresAt: n.expiresAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
