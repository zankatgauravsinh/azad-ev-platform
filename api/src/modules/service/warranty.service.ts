import { Injectable } from '@nestjs/common';
import type { WarrantyStatusDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Computes vehicle warranty status: from the vehicle's warranty card when it has one (its start date and
 * period — the longest component's months), else from the delivery date and the company-configured period.
 * Part warranty is tracked per fitted ServicePart via the SparePart.warrantyMonths at the time of fitment.
 */
@Injectable()
export class WarrantyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Warranty start = the vehicle's delivery date (booking → actualDelivery), else purchase date. */
  async vehicleWarranty(unitId: string): Promise<WarrantyStatusDto['vehicle']> {
    const card = await this.prisma.warranty.findFirst({ where: { unitId, status: { not: 'CANCELLED' } }, select: { startDate: true, periodMonths: true }, orderBy: { createdAt: 'desc' } });
    if (card) return this.statusFrom(card.periodMonths, card.startDate);
    const [company, unit, delivered] = await Promise.all([
      this.prisma.companySetting.findFirstOrThrow({ select: { defaultWarrantyMonths: true } }),
      this.prisma.inventoryUnit.findFirst({ where: { id: unitId }, select: { purchaseDate: true } }),
      this.prisma.booking.findFirst({ where: { unitId, actualDelivery: { not: null } }, select: { actualDelivery: true }, orderBy: { actualDelivery: 'desc' } }),
    ]);
    const start = delivered?.actualDelivery ?? unit?.purchaseDate ?? null;
    return this.statusFrom(company.defaultWarrantyMonths, start);
  }

  /**
   * Batched form of {@link vehicleWarranty} for list views — one query per data
   * source instead of three per row. Returns a map keyed by unit id.
   */
  async vehicleWarranties(unitIds: string[]): Promise<Map<string, WarrantyStatusDto['vehicle']>> {
    const result = new Map<string, WarrantyStatusDto['vehicle']>();
    const ids = [...new Set(unitIds)];
    if (ids.length === 0) return result;
    const [company, units, deliveries, cards] = await Promise.all([
      this.prisma.companySetting.findFirstOrThrow({ select: { defaultWarrantyMonths: true } }),
      this.prisma.inventoryUnit.findMany({ where: { id: { in: ids } }, select: { id: true, purchaseDate: true } }),
      this.prisma.booking.findMany({ where: { unitId: { in: ids }, actualDelivery: { not: null } }, select: { unitId: true, actualDelivery: true }, orderBy: { actualDelivery: 'desc' } }),
      this.prisma.warranty.findMany({ where: { unitId: { in: ids }, status: { not: 'CANCELLED' } }, select: { unitId: true, startDate: true, periodMonths: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const months = company.defaultWarrantyMonths;
    const cardBy = new Map<string, { startDate: Date; periodMonths: number }>();
    for (const c of cards) if (!cardBy.has(c.unitId)) cardBy.set(c.unitId, c);
    const purchaseBy = new Map(units.map((u) => [u.id, u.purchaseDate]));
    const deliveredBy = new Map<string, Date>();
    // Ordered desc, so the first entry seen for a unit is its latest delivery.
    for (const d of deliveries) if (d.actualDelivery && !deliveredBy.has(d.unitId)) deliveredBy.set(d.unitId, d.actualDelivery);
    for (const id of ids) {
      const card = cardBy.get(id);
      if (card) {
        result.set(id, this.statusFrom(card.periodMonths, card.startDate));
        continue;
      }
      const start = deliveredBy.get(id) ?? purchaseBy.get(id) ?? null;
      result.set(id, this.statusFrom(months, start));
    }
    return result;
  }

  private statusFrom(months: number, start: Date | null): WarrantyStatusDto['vehicle'] {
    if (!start) return { months, startDate: null, endDate: null, active: false, daysRemaining: 0 };
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    const msLeft = end.getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
    return { months, startDate: start.toISOString(), endDate: end.toISOString(), active: msLeft > 0, daysRemaining };
  }
}
