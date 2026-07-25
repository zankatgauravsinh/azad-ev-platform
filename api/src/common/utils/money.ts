/** Money helpers. Amounts are stored and transported as integer paise (₹ × 100). */

export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

export function paiseToRupees(paise: bigint | number): number {
  return Number(paise) / 100;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatInr(paise: bigint | number): string {
  return inr.format(paiseToRupees(paise));
}
