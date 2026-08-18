import { Injectable } from '@nestjs/common';
import { PaymentContext, Role, ServiceStatus } from '@azad/shared';
import type {
  DailyServiceReport,
  ServiceReports,
  ServiceRevenueReport,
  TechnicianPerformanceRow,
  WarrantyClaimsReport,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Read-only analytics over service data. Every figure comes from an aggregate/groupBy — no N+1. */
@Injectable()
export class ServiceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(day = new Date()): Promise<ServiceReports> {
    const [daily, technicians, revenue, warranty, repeatComplaints, topReplacedParts] = await Promise.all([
      this.daily(day),
      this.technicians(),
      this.revenue(),
      this.warranty(),
      this.repeatComplaints(),
      this.topReplacedParts(),
    ]);
    return { daily, technicians, revenue, warranty, repeatComplaints, topReplacedParts };
  }

  async daily(day: Date): Promise<DailyServiceReport> {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const [created, delivered, collected, byStatus] = await Promise.all([
      this.prisma.serviceJob.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.serviceJob.count({ where: { actualDelivery: { gte: start, lt: end } } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: PaymentContext.SERVICE, paidAt: { gte: start, lt: end } } }),
      this.prisma.serviceJob.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      date: start.toISOString(),
      created,
      delivered,
      collected: (collected._sum.amount ?? 0n).toString(),
      byStatus: byStatus.map((s) => ({ status: s.status as ServiceStatus, count: s._count._all })),
    };
  }

  async technicians(): Promise<TechnicianPerformanceRow[]> {
    const [techs, totals, delivered, ratings] = await Promise.all([
      this.prisma.user.findMany({ where: { role: Role.TECHNICIAN }, select: { id: true, name: true } }),
      this.prisma.serviceJob.groupBy({ by: ['technicianId'], _count: { _all: true } }),
      this.prisma.serviceJob.groupBy({ by: ['technicianId'], where: { status: ServiceStatus.DELIVERED }, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.serviceJob.groupBy({ by: ['technicianId'], where: { feedbackRating: { not: null } }, _avg: { feedbackRating: true } }),
    ]);
    const totalMap = new Map(totals.map((t) => [t.technicianId, t._count._all]));
    const delMap = new Map(delivered.map((d) => [d.technicianId, d]));
    const rateMap = new Map(ratings.map((r) => [r.technicianId, r._avg.feedbackRating]));
    return techs.map((t) => ({
      technicianId: t.id,
      name: t.name,
      totalJobs: totalMap.get(t.id) ?? 0,
      delivered: delMap.get(t.id)?._count._all ?? 0,
      revenue: (delMap.get(t.id)?._sum.total ?? 0n).toString(),
      avgRating: rateMap.get(t.id) ?? null,
    }));
  }

  async revenue(): Promise<ServiceRevenueReport> {
    const [billed, collected, parts, labour, jobs] = await Promise.all([
      this.prisma.serviceJob.aggregate({ _sum: { total: true }, where: { status: ServiceStatus.DELIVERED } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { context: PaymentContext.SERVICE } }),
      this.prisma.serviceJob.aggregate({ _sum: { partsTotal: true }, where: { status: ServiceStatus.DELIVERED } }),
      this.prisma.serviceJob.aggregate({ _sum: { labourTotal: true }, where: { status: ServiceStatus.DELIVERED } }),
      this.prisma.serviceJob.count({ where: { status: ServiceStatus.DELIVERED } }),
    ]);
    return {
      billed: (billed._sum.total ?? 0n).toString(),
      collected: (collected._sum.amount ?? 0n).toString(),
      partsRevenue: (parts._sum.partsTotal ?? 0n).toString(),
      labourRevenue: (labour._sum.labourTotal ?? 0n).toString(),
      jobs,
    };
  }

  async warranty(): Promise<WarrantyClaimsReport> {
    const [warrantyJobs, warrantyParts, recent] = await Promise.all([
      this.prisma.serviceJob.count({ where: { OR: [{ type: 'WARRANTY' }, { underWarranty: true }] } }),
      this.prisma.servicePart.count({ where: { warranty: true } }),
      this.prisma.serviceJob.findMany({ where: { OR: [{ type: 'WARRANTY' }, { underWarranty: true }] }, orderBy: { createdAt: 'desc' }, take: 10, select: { code: true, createdAt: true, customer: { select: { name: true } } } }),
    ]);
    return { warrantyJobs, warrantyParts, recent: recent.map((r) => ({ code: r.code, customer: r.customer.name, createdAt: r.createdAt.toISOString() })) };
  }

  async repeatComplaints(): Promise<{ label: string; count: number }[]> {
    const rows = await this.prisma.serviceComplaint.groupBy({
      by: ['description'],
      _count: { _all: true },
      having: { description: { _count: { gt: 1 } } },
      orderBy: { _count: { description: 'desc' } },
      take: 10,
    });
    return rows.map((r) => ({ label: r.description, count: r._count._all }));
  }

  async topReplacedParts(): Promise<{ name: string; qty: number }[]> {
    const rows = await this.prisma.servicePart.groupBy({
      by: ['name'],
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 10,
    });
    return rows.map((r) => ({ name: r.name, qty: r._sum.qty ?? 0 }));
  }
}
