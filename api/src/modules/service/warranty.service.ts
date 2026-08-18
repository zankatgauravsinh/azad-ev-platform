import { Injectable } from '@nestjs/common';
import type { WarrantyStatusDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Computes vehicle warranty status from the delivery date and the
 * company-configured warranty period. Part warranty is tracked per fitted
 * ServicePart via the SparePart.warrantyMonths at the time of fitment.
 */
@Injectable()
export class WarrantyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Warranty start = the vehicle's delivery date (booking → actualDelivery), else purchase date. */
  async vehicleWarranty(unitId: string): Promise<WarrantyStatusDto['vehicle']> {
    const [company, unit, delivered] = await Promise.all([
      this.prisma.companySetting.findFirstOrThrow({ select: { defaultWarrantyMonths: true } }),
      this.prisma.inventoryUnit.findFirst({ where: { id: unitId }, select: { purchaseDate: true } }),
      this.prisma.booking.findFirst({ where: { unitId, actualDelivery: { not: null } }, select: { actualDelivery: true }, orderBy: { actualDelivery: 'desc' } }),
    ]);
    const months = company.defaultWarrantyMonths;
    const start = delivered?.actualDelivery ?? unit?.purchaseDate ?? null;
    if (!start) return { months, startDate: null, endDate: null, active: false, daysRemaining: 0 };
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    const msLeft = end.getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
    return { months, startDate: start.toISOString(), endDate: end.toISOString(), active: msLeft > 0, daysRemaining };
  }
}
