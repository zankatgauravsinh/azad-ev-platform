import type { PrismaService } from '../../prisma/prisma.service';
import { businessDateOf } from '../../common/utils/business-date';
import { periodCovers, toCalendarDate } from '../tax/tax-calendar';

export type AccessoryGstRate = { gstRateBp: number; hsnCode: string | null };

/**
 * GST rate (basis points) and HSN per accessory: its classification's rate on today's business date; exempt /
 * nil-rated classifications are 0%; an accessory with no classification, or no rate for today, takes `defaultBp`.
 * Used by accessory sales (GST inside the price) and purchases (GST on top of the cost).
 */
export async function accessoryGstRates(
  prisma: PrismaService,
  accessories: { id: string; taxClassificationId: string | null }[],
  defaultBp: number,
  timeZone: string,
): Promise<Map<string, AccessoryGstRate>> {
  const classIds = [...new Set(accessories.map((a) => a.taxClassificationId).filter((c): c is string => Boolean(c)))];
  const classes = classIds.length
    ? await prisma.taxClassification.findMany({ where: { id: { in: classIds }, deletedAt: null }, select: { id: true, code: true, treatment: true, rates: { where: { isActive: true }, select: { ratePercent: true, effectiveFrom: true, effectiveTo: true } } } })
    : [];
  const today = businessDateOf(new Date(), timeZone);
  const byClass = new Map<string, AccessoryGstRate>(
    classes.map((c) => {
      if (c.treatment !== 'TAXABLE') return [c.id, { gstRateBp: 0, hsnCode: c.code }];
      const rate = c.rates.find((r) => periodCovers(toCalendarDate(r.effectiveFrom), r.effectiveTo ? toCalendarDate(r.effectiveTo) : null, today));
      return [c.id, { gstRateBp: rate ? Math.round(Number(rate.ratePercent) * 100) : defaultBp, hsnCode: c.code }];
    }),
  );
  return new Map(accessories.map((a) => [a.id, (a.taxClassificationId && byClass.get(a.taxClassificationId)) || { gstRateBp: defaultBp, hsnCode: null }]));
}
