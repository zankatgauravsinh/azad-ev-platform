import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Indian identity numbers printed on the RTO invoice: Aadhaar, PAN, GSTIN. Normalised (spaces removed,
 * upper-case) and checked — Aadhaar and GSTIN carry check digits, so a single mistyped character is caught.
 * ------------------------------------------------------------------ */

// Verhoeff tables (the checksum UIDAI uses for Aadhaar).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** A valid Aadhaar number: 12 digits, not starting with 0 or 1, Verhoeff check digit correct. */
export function isValidAadhaar(value: string): boolean {
  if (!/^[2-9]\d{11}$/.test(value)) return false;
  let c = 0;
  [...value].reverse().forEach((ch, i) => { c = D[c]![P[i % 8]![Number(ch)]!]!; });
  return c === 0;
}

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const isValidPan = (value: string): boolean => PAN.test(value);

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A valid GSTIN: state code + PAN + entity + 'Z' + check character (GSTN's base-36 checksum). */
export function isValidGstin(value: string): boolean {
  if (!GSTIN.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === value[14];
}

/** The PAN inside a GSTIN (characters 3–12), or null when the value is not a GSTIN. */
export const panFromGstin = (gstin: string | null | undefined): string | null => {
  const v = gstin?.trim().toUpperCase() ?? '';
  return GSTIN.test(v) ? v.slice(2, 12) : null;
};

/** 'XXXX XXXX 3132' — for screens; the RTO invoice prints the full number. */
export const maskAadhaar = (aadhaar: string | null | undefined): string | null => (aadhaar ? `XXXX XXXX ${aadhaar.slice(-4)}` : null);
/** '2395 2360 3132' — the printed grouping. */
export const formatAadhaar = (aadhaar: string): string => aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * An optional identity field for create/update: spaces and dashes removed, upper-cased; '' or null clears it
 * (stored as null); otherwise it must pass `valid`.
 */
export const optionalIdentity = (valid: (v: string) => boolean, message: string) =>
  z
    .union([z.literal(''), z.string()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? v : v.replace(/[\s-]/g, '').toUpperCase() || null))
    .refine((v) => v == null || valid(v), message);
