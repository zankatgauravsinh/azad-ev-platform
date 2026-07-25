/** Pure money maths for the sales domain. All values are paise (BigInt). */

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

/** On-road total: ex-showroom − discount − exchange + accessories + rto + insurance + registration + extended warranty + tax. Never below zero. */
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
  return total > 0n ? total : 0n;
}
