import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LeadStatus,
  UnitStatus,
  type BusinessOverview,
  type DashboardCharts,
  type DashboardReminders,
  type DashboardSummary,
  type RecentActivityItem,
  type ReminderItem,
  type TodaysWork,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { fillMonths } from './chart-utils';

const LOW_STOCK = 2;
const ACTIVITY_TYPES = ['BOOKING', 'ADVANCE_PAYMENT', 'VEHICLE_ASSIGNED', 'DELIVERY', 'FINANCE_APPROVED', 'INSURANCE_ADDED', 'LEAD_CREATED', 'FIRST_SERVICE', 'INVOICE_GENERATED'];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Raw SQL bypasses the Prisma tenant middleware, so scope it explicitly.
    const company = this.tenant.requireCompanyId();

    const [todaysWork, businessOverview, recentActivity, reminders, charts] = await Promise.all([
      this.todaysWork(todayStart, todayEnd, company),
      this.businessOverview(todayStart, todayEnd, monthStart),
      this.recentActivity(),
      this.reminders(todayStart, company),
      this.charts(company),
    ]);

    return { todaysWork, businessOverview, recentActivity, reminders, charts, generatedAt: now.toISOString() };
  }

  // ── Section 1: Today's work ─────────────────────────────
  private async todaysWork(todayStart: Date, todayEnd: Date, company: string): Promise<TodaysWork> {
    const [deliveries, followUps, pending, pendingFinance, pendingInsurance, lowInv, overdue] = await Promise.all([
      this.prisma.booking.count({ where: { status: { not: 'CANCELLED' }, actualDelivery: null, expectedDelivery: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.customerFollowUp.count({ where: { status: 'PENDING', dueAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.$queryRaw<{ count: number; balance: bigint }[]>`
        SELECT COUNT(*)::int AS count, COALESCE(SUM(b.total - COALESCE(p.paid, 0)), 0)::bigint AS balance
        FROM "Booking" b
        LEFT JOIN (SELECT "bookingId", SUM(amount) paid FROM "Payment" GROUP BY "bookingId") p ON p."bookingId" = b.id
        WHERE b."deletedAt" IS NULL AND b."companyId" = ${company} AND b.status <> 'CANCELLED' AND (b.total - COALESCE(p.paid, 0)) > 0`,
      this.prisma.financeDetail.count({ where: { status: 'PENDING', booking: { status: { not: 'CANCELLED' } } } }),
      this.prisma.booking.count({ where: { status: { not: 'CANCELLED' }, insuranceRequired: true, OR: [{ insurance: { is: null } }, { insurance: { status: 'PENDING' } }] } }),
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "ScooterModel" m
        LEFT JOIN (SELECT v."modelId", COUNT(*) c FROM "InventoryUnit" u JOIN "ScooterVariant" v ON v.id = u."variantId" WHERE u.status = 'AVAILABLE' AND u."deletedAt" IS NULL AND u."companyId" = ${company} GROUP BY v."modelId") a ON a."modelId" = m.id
        WHERE m."isActive" = true AND m."companyId" = ${company} AND COALESCE(a.c, 0) <= ${LOW_STOCK}`,
      this.prisma.booking.count({ where: { status: { not: 'CANCELLED' }, actualDelivery: null, expectedDelivery: { lt: todayStart } } }),
    ]);

    return {
      deliveries,
      followUps,
      pendingPayments: { count: Number(pending[0]?.count ?? 0), amount: (pending[0]?.balance ?? 0n).toString() },
      pendingFinanceApprovals: pendingFinance,
      pendingInsurance,
      serviceDueToday: 0, // Service module (Module 5) will populate this.
      lowInventory: Number(lowInv[0]?.count ?? 0),
      overdueBookings: overdue,
    };
  }

  // ── Section 2: Business overview ────────────────────────
  private async businessOverview(todayStart: Date, todayEnd: Date, monthStart: Date): Promise<BusinessOverview> {
    const [todaySales, todayColl, monthSales, monthColl, available, booked, delivered, activeCustomers] = await Promise.all([
      this.prisma.sale.aggregate({ where: { invoicedAt: { gte: todayStart, lt: todayEnd } }, _count: true, _sum: { total: true } }),
      this.prisma.payment.aggregate({ where: { paidAt: { gte: todayStart, lt: todayEnd } }, _sum: { amount: true } }),
      this.prisma.sale.aggregate({ where: { invoicedAt: { gte: monthStart } }, _count: true, _sum: { total: true } }),
      this.prisma.payment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.AVAILABLE } }),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.BOOKED } }),
      this.prisma.inventoryUnit.count({ where: { status: UnitStatus.DELIVERED } }),
      this.prisma.customer.count({ where: { leadStatus: { not: LeadStatus.LOST } } }),
    ]);

    return {
      todaySales: { count: todaySales._count, amount: (todaySales._sum.total ?? 0n).toString() },
      todayCollections: (todayColl._sum.amount ?? 0n).toString(),
      monthlySales: { count: monthSales._count, amount: (monthSales._sum.total ?? 0n).toString() },
      monthlyCollections: (monthColl._sum.amount ?? 0n).toString(),
      availableInventory: available,
      bookedInventory: booked,
      deliveredVehicles: delivered,
      activeCustomers,
    };
  }

  // ── Section 3: Recent activity (newest first) ───────────
  private async recentActivity(): Promise<RecentActivityItem[]> {
    const entries = await this.prisma.customerTimelineEntry.findMany({
      where: { type: { in: ACTIVITY_TYPES as Prisma.CustomerTimelineEntryWhereInput['type'][] as never } },
      orderBy: { occurredAt: 'desc' },
      take: 15,
      include: { customer: { select: { id: true, name: true } } },
    });
    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      customer: e.customer ? { id: e.customer.id, name: e.customer.name } : null,
      occurredAt: e.occurredAt.toISOString(),
    }));
  }

  // ── Reminders (from real data) ──────────────────────────
  private async reminders(todayStart: Date, company: string): Promise<DashboardReminders> {
    const [upcoming, followUps, docs, balances] = await Promise.all([
      this.prisma.booking.findMany({
        where: { status: { not: 'CANCELLED' }, actualDelivery: null, expectedDelivery: { gte: todayStart } },
        orderBy: { expectedDelivery: 'asc' },
        take: 5,
        include: { customer: { select: { name: true } }, unit: { select: { vin: true, variant: { select: { name: true, model: { select: { name: true } } } } } } },
      }),
      this.prisma.customerFollowUp.findMany({
        where: { status: 'PENDING' },
        orderBy: { dueAt: 'asc' },
        take: 5,
        include: { customer: { select: { id: true, name: true } } },
      }),
      this.prisma.booking.findMany({
        where: { status: { not: 'CANCELLED' }, actualDelivery: null, pendingDocuments: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.$queryRaw<{ id: string; code: string; name: string; balance: bigint }[]>`
        SELECT b.id, b.code, c.name, (b.total - COALESCE(p.paid, 0))::bigint AS balance
        FROM "Booking" b
        JOIN "Customer" c ON c.id = b."customerId"
        LEFT JOIN (SELECT "bookingId", SUM(amount) paid FROM "Payment" GROUP BY "bookingId") p ON p."bookingId" = b.id
        WHERE b."deletedAt" IS NULL AND b."companyId" = ${company} AND b.status <> 'CANCELLED' AND (b.total - COALESCE(p.paid, 0)) > 0
        ORDER BY balance DESC LIMIT 5`,
    ]);

    return {
      upcomingDeliveries: upcoming.map((b): ReminderItem => ({
        id: b.id,
        label: b.customer.name,
        sub: `${b.unit.variant.model.name} ${b.unit.variant.name} · ${b.unit.vin}`,
        date: b.expectedDelivery?.toISOString() ?? null,
        href: `/bookings/${b.id}`,
      })),
      followUps: followUps.map((f): ReminderItem => ({
        id: f.id,
        label: f.customer.name,
        sub: f.note ?? 'Follow-up',
        date: f.dueAt.toISOString(),
        href: `/customers/${f.customer.id}`,
      })),
      pendingDocuments: docs.map((b): ReminderItem => ({
        id: b.id,
        label: b.customer.name,
        sub: b.pendingDocuments ?? 'Documents pending',
        date: null,
        href: `/bookings/${b.id}`,
      })),
      pendingBalance: balances.map((b): ReminderItem => ({
        id: b.id,
        label: b.name,
        sub: `Booking ${b.code}`,
        date: null,
        href: `/bookings/${b.id}`,
      })).map((r, i) => ({ ...r, sub: `${r.sub} · ₹${(Number(balances[i]!.balance) / 100).toLocaleString('en-IN')}` })),
      serviceDue: [],
    };
  }

  // ── Charts (only three) ─────────────────────────────────
  private async charts(company: string): Promise<DashboardCharts> {
    const [sales, collections, leads] = await Promise.all([
      this.prisma.$queryRaw<{ month: string; amount: bigint; count: number }[]>`
        SELECT to_char(date_trunc('month', "invoicedAt"), 'YYYY-MM') AS month, COALESCE(SUM(total), 0)::bigint AS amount, COUNT(*)::int AS count
        FROM "Sale" WHERE "invoicedAt" >= date_trunc('month', now()) - interval '5 months' AND "deletedAt" IS NULL AND "companyId" = ${company}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ month: string; amount: bigint; count: number }[]>`
        SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0)::bigint AS amount, COUNT(*)::int AS count
        FROM "Payment" WHERE "paidAt" >= date_trunc('month', now()) - interval '5 months' AND "companyId" = ${company}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.customer.groupBy({ by: ['leadStatus'], _count: { _all: true } }),
    ]);

    return {
      monthlySales: fillMonths(sales),
      monthlyCollections: fillMonths(collections),
      leadConversion: leads.map((l) => ({ status: l.leadStatus as LeadStatus, count: l._count._all })),
    };
  }
}
