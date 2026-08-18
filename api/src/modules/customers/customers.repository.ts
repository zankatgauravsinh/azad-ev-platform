import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LeadStatus } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

const userRef = { select: { id: true, name: true, role: true } } satisfies Prisma.UserDefaultArgs;
const modelRef = { select: { id: true, name: true, brand: true } } satisfies Prisma.ScooterModelDefaultArgs;
const customerRef = { select: { id: true, name: true, phone: true } } satisfies Prisma.CustomerDefaultArgs;

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  readonly include = {
    preferredModel: modelRef,
    assignedTo: userRef,
  } satisfies Prisma.CustomerInclude;

  findMany(args: {
    where: Prisma.CustomerWhereInput;
    orderBy: Prisma.CustomerOrderByWithRelationInput;
    skip: number;
    take: number;
  }) {
    return this.prisma.customer.findMany({
      ...args,
      include: {
        ...this.include,
        _count: { select: { bookings: true, sales: true } },
      },
    });
  }

  count(where: Prisma.CustomerWhereInput): Promise<number> {
    return this.prisma.customer.count({ where });
  }

  findByPhone(phone: string) {
    return this.prisma.customer.findUnique({ where: { phone } });
  }

  findById(id: string) {
    return this.prisma.customer.findFirst({ where: { id }, include: this.include });
  }

  create(data: Prisma.CustomerUncheckedCreateInput, db: Db = this.prisma) {
    return db.customer.create({ data, include: this.include });
  }

  update(id: string, data: Prisma.CustomerUncheckedUpdateInput, db: Db = this.prisma) {
    return db.customer.update({ where: { id }, data, include: this.include });
  }

  softDelete(id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }

  async pendingFollowUpCounts(customerIds: string[]): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();
    const grouped = await this.prisma.customerFollowUp.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, status: 'PENDING' },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.customerId, g._count._all]));
  }

  async stats(): Promise<{ total: number; byStatus: Record<LeadStatus, number> }> {
    const grouped = await this.prisma.customer.groupBy({
      by: ['leadStatus'],
      _count: { _all: true },
    });
    const byStatus = {
      NEW: 0,
      CONTACTED: 0,
      INTERESTED: 0,
      TEST_RIDE: 0,
      NEGOTIATION: 0,
      BOOKED: 0,
      WON: 0,
      LOST: 0,
    } as Record<LeadStatus, number>;
    let total = 0;
    for (const g of grouped) {
      byStatus[g.leadStatus as LeadStatus] = g._count._all;
      total += g._count._all;
    }
    return { total, byStatus };
  }

  // ── Related collections (populate as later modules add data) ──
  bookings(customerId: string) {
    return this.prisma.booking.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, status: true, createdAt: true },
    });
  }

  payments(customerId: string) {
    return this.prisma.payment.findMany({
      where: {
        OR: [
          { booking: { customerId } },
          { sale: { customerId } },
          { serviceJob: { customerId } },
        ],
      },
      orderBy: { paidAt: 'desc' },
      select: { id: true, amount: true, mode: true, context: true, paidAt: true },
    });
  }

  deliveries(customerId: string) {
    return this.prisma.delivery.findMany({
      where: { sale: { customerId } },
      orderBy: { deliveredAt: 'desc' },
      select: { id: true, saleId: true, deliveredAt: true, sale: { select: { unit: { select: { vin: true } } } } },
    });
  }

  service(customerId: string) {
    return this.prisma.serviceJob.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, code: true, status: true, type: true, priority: true, total: true, createdAt: true,
        technician: { select: { name: true } },
        complaints: { select: { description: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /** Delivered units → warranty windows from variant.warrantyMonths + delivery date. */
  warrantySales(customerId: string) {
    return this.prisma.sale.findMany({
      where: { customerId, delivery: { isNot: null } },
      select: {
        unit: {
          select: {
            id: true,
            vin: true,
            variant: { select: { name: true, warrantyMonths: true, model: { select: { name: true } } } },
          },
        },
        delivery: { select: { deliveredAt: true } },
      },
    });
  }

  activity(customerId: string) {
    return this.prisma.activityLog.findMany({
      where: { entityType: 'Customer', entityId: customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Documents ──────────────────────────────────────────
  listDocuments(customerId: string) {
    return this.prisma.customerDocument.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }
  findDocument(id: string) {
    return this.prisma.customerDocument.findUnique({ where: { id } });
  }
  addDocument(data: Prisma.CustomerDocumentUncheckedCreateInput) {
    return this.prisma.customerDocument.create({ data });
  }
  updateDocument(id: string, data: Prisma.CustomerDocumentUncheckedUpdateInput) {
    return this.prisma.customerDocument.update({ where: { id }, data });
  }
  deleteDocument(id: string) {
    return this.prisma.customerDocument.delete({ where: { id } });
  }

  /** Customer ids that own a booking/sale/unit matching a search term. */
  async idsMatchingRelated(q: string): Promise<string[]> {
    const [bookings, sales] = await Promise.all([
      this.prisma.booking.findMany({
        where: { code: { contains: q, mode: 'insensitive' } },
        select: { customerId: true },
        take: 200,
      }),
      this.prisma.sale.findMany({
        where: {
          OR: [
            { invoiceNumber: { contains: q, mode: 'insensitive' } },
            { unit: { vin: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: { customerId: true },
        take: 200,
      }),
    ]);
    return [...new Set([...bookings, ...sales].map((r) => r.customerId))];
  }

  static readonly customerRef = customerRef;
}
