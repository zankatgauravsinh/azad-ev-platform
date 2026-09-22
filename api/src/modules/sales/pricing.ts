/** Money maths for the sales domain. All values are paise (BigInt). */
import { BadRequestException } from '@nestjs/common';

export interface AccessoryLine {
  qty: number;
  unitPrice: bigint | number;
}

export function sumAccessories(lines: AccessoryLine[]): bigint {
  return lines.reduce((total, l) => total + BigInt(l.unitPrice) * BigInt(l.qty), 0n);
}

export interface PriceComponents {
  exShowroom: bigint | number;
  discount: bigint | number;
  exchangeValue: bigint | number;
  accessoriesTotal: bigint | number;
  rto: bigint | number;
  insurance: bigint | number;
  registration: bigint | number;
  extendedWarranty: bigint | number;
  taxAmount?: bigint | number;
}

/**
 * On-road total: ex-showroom − discount − exchange + accessories + rto + insurance + registration + extended warranty + tax.
 * A negative result means the discount and exchange exceed the price plus charges — always a data-entry error, so we reject
 * it rather than silently booking a ₹0 deal.
 */
export function computeTotal(c: PriceComponents): bigint {
  const total =
    BigInt(c.exShowroom) -
    BigInt(c.discount) -
    BigInt(c.exchangeValue) +
    BigInt(c.accessoriesTotal) +
    BigInt(c.rto) +
    BigInt(c.insurance) +
    BigInt(c.registration) +
    BigInt(c.extendedWarranty) +
    BigInt(c.taxAmount ?? 0);
  if (total < 0n) throw new BadRequestException('Discount and exchange value exceed the on-road price — check the figures');
  return total;
}
