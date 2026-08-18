import { Injectable } from '@nestjs/common';
import type { SearchResults } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(term: string): Promise<SearchResults> {
    const q = term.trim();
    if (q.length < 2) return { customers: [], units: [], bookings: [], invoices: [], serviceJobs: [], warranties: [], amc: [], expenses: [], vendors: [], income: [] };

    const [customers, units, bookings, invoices, serviceJobs, warranties, amc, expenses, vendors, income] = await Promise.all([
      this.prisma.customer.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { altPhone: { contains: q } }] },
        take: 5,
        select: { id: true, name: true, phone: true },
      }),
      this.prisma.inventoryUnit.findMany({
        where: { OR: [{ vin: { contains: q, mode: 'insensitive' } }, { motorNumber: { contains: q, mode: 'insensitive' } }, { batteryNumber: { contains: q, mode: 'insensitive' } }] },
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
      this.prisma.serviceJob.findMany({
        where: {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { unit: { vin: { contains: q, mode: 'insensitive' } } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { customer: { phone: { contains: q } } },
            { complaints: { some: { description: { contains: q, mode: 'insensitive' } } } },
            { technician: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 5,
        select: { id: true, code: true, status: true, customer: { select: { name: true } }, technician: { select: { name: true } } },
      }),
      this.prisma.warranty.findMany({
        where: {
          OR: [
            { warrantyNumber: { contains: q, mode: 'insensitive' } },
            { motorNumber: { contains: q, mode: 'insensitive' } },
            { batteryNumber: { contains: q, mode: 'insensitive' } },
            { unit: { vin: { contains: q, mode: 'insensitive' } } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { claims: { some: { claimNumber: { contains: q, mode: 'insensitive' } } } },
          ],
        },
        take: 5,
        select: { id: true, warrantyNumber: true, status: true, customer: { select: { name: true } } },
      }),
      this.prisma.amcPlan.findMany({
        where: {
          OR: [
            { amcNumber: { contains: q, mode: 'insensitive' } },
            { unit: { vin: { contains: q, mode: 'insensitive' } } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 5,
        select: { id: true, amcNumber: true, status: true, customer: { select: { name: true } } },
      }),
      this.prisma.expense.findMany({
        where: {
          OR: [
            { expenseNumber: { contains: q, mode: 'insensitive' } },
            { referenceNumber: { contains: q, mode: 'insensitive' } },
            { vendor: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 5,
        select: { id: true, expenseNumber: true, amount: true, gstAmount: true, category: { select: { name: true } } },
      }),
      this.prisma.vendor.findMany({
        where: { OR: [{ vendorNumber: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { gstNumber: { contains: q, mode: 'insensitive' } }] },
        take: 5,
        select: { id: true, vendorNumber: true, name: true },
      }),
      this.prisma.income.findMany({
        where: { OR: [{ incomeNumber: { contains: q, mode: 'insensitive' } }, { referenceNumber: { contains: q, mode: 'insensitive' } }] },
        take: 5,
        select: { id: true, incomeNumber: true, source: true },
      }),
    ]);

    return {
      customers,
      units: units.map((u) => ({ id: u.id, vin: u.vin, status: u.status, model: `${u.variant.model.name} ${u.variant.name}` })),
      bookings: bookings.map((b) => ({ id: b.id, code: b.code, customer: b.customer.name, status: b.status })),
      invoices: invoices.map((s) => ({ id: s.id, invoiceNumber: s.invoiceNumber ?? '', customer: s.customer.name })),
      serviceJobs: serviceJobs.map((s) => ({ id: s.id, code: s.code, customer: s.customer.name, status: s.status, technician: s.technician?.name ?? null })),
      warranties: warranties.map((w) => ({ id: w.id, warrantyNumber: w.warrantyNumber, customer: w.customer.name, status: w.status })),
      amc: amc.map((a) => ({ id: a.id, amcNumber: a.amcNumber, customer: a.customer.name, status: a.status })),
      expenses: expenses.map((e) => ({ id: e.id, expenseNumber: e.expenseNumber, category: e.category.name, amount: String(e.amount + e.gstAmount) })),
      vendors: vendors.map((v) => ({ id: v.id, vendorNumber: v.vendorNumber, name: v.name })),
      income: income.map((i) => ({ id: i.id, incomeNumber: i.incomeNumber, source: i.source })),
    };
  }
}
