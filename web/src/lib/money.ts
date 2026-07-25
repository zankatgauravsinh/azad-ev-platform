/**
 * Money helpers. The API sends/stores amounts as integer paise (₹ x 100),
 * serialised as strings (BigInt). Convert only at the UI edge.
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** paise (string|number|bigint) → "₹1,24,000" */
export function formatPaise(paise: string | number | bigint): string {
  const value = Number(paise) / 100;
  return inr.format(value);
}

/** rupees (number) → paise (number) for sending to the API */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** paise → rupees number (for form fields) */
export function paiseToRupees(paise: string | number | bigint): number {
  return Number(paise) / 100;
}

/** paise → compact ₹ (e.g. ₹1.2L, ₹3.4Cr) for charts and tiles. */
export function formatCompactPaise(paise: string | number | bigint): string {
  const r = Number(paise) / 100;
  if (r >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(1)}Cr`;
  if (r >= 1_00_000) return `₹${(r / 1_00_000).toFixed(1)}L`;
  if (r >= 1_000) return `₹${(r / 1_000).toFixed(1)}K`;
  return `₹${Math.round(r)}`;
}
