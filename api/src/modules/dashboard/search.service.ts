import { Injectable } from '@nestjs/common';
import type { SearchResults } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(term: string): Promise<SearchResults> {
    const q = term.trim();
    if (q.length < 2) return { customers: [], units: [], bookings: [], invoices: [] };

    const [customers, units, bookings, invoices] = await Promise.all([
      this.prisma.customer.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { altPhone: { contains: q } }] },
        take: 5,
        select: { id: true, name: true, phone: true },
      }),
      this.prisma.inventoryUnit.findMany({
        where: { OR: [{ vin: { contains: q, mode: 'insensitive' } }, { motorNumber: { contains: q, mode: 'insensitive' } }] },
        take: 5,
        select: { id: true, vin: true, status: true, variant: { select: { name: true, model: { select: { name: true } } } } },
      }),
      this.prisma.booking.findMany({
        where: { OR: [{ code: { contains: q, mode: 'insensitive' } }, { unit: { vin: { contains: q, mode: 'insensitive' } } }, { customer: { name: { contains: q, mode: 'insensitive' } } }] },
        take: 5,
        select: { id: true, code: true, status: true, customer: { select: { name: true } } },
      }),
      this.prisma.sale.findMany({
        where: { invoiceNumber: { contains: q, mode: 'insensitive' } },
        take: 5,
        select: { id: true, invoiceNumber: true, customer: { select: { name: true } } },
      }),
    ]);

    return {
      customers,
      units: units.map((u) => ({ id: u.id, vin: u.vin, status: u.status, model: `${u.variant.model.name} ${u.variant.name}` })),
      bookings: bookings.map((b) => ({ id: b.id, code: b.code, customer: b.customer.name, status: b.status })),
      invoices: invoices.map((s) => ({ id: s.id, invoiceNumber: s.invoiceNumber ?? '', customer: s.customer.name })),
    };
  }
}
