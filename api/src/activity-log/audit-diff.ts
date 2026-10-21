import { PURCHASE_COST_FIELDS, maskAadhaar } from '@azad/shared';

/**
 * What changed on a record, for the audit trail: { field: { from, to } }. Values are plain JSON — bigint money
 * as a paise string, dates as ISO strings, objects as JSON text (capped). Secrets are never recorded, Aadhaar
 * numbers only masked. Purchase-cost fields keep their names (PURCHASE_COST_FIELDS), so the API strips them
 * from responses for anyone without inventory.cost — and changesSummary never prints their values.
 */
export type AuditValue = string | number | boolean | null;
export type FieldChanges = Record<string, { from: AuditValue; to: AuditValue }>;

/** Never recorded, whatever a caller passes. */
const SECRET_FIELDS: ReadonlySet<string> = new Set(['password', 'passwordHash', 'refreshTokenHash', 'tokenHash', 'token']);
/** Recorded masked (last four digits). */
const MASKED_FIELDS: Readonly<Record<string, (v: string) => string>> = {
  aadhaarNumber: (v) => maskAadhaar(v) ?? '',
  aadhaar: (v) => maskAadhaar(v) ?? '',
};
const COST_FIELDS: ReadonlySet<string> = new Set(PURCHASE_COST_FIELDS);
const OBJECT_TEXT_MAX = 500;

/** One value as the audit trail stores it. */
export function auditValue(v: unknown, field?: string): AuditValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return field && MASKED_FIELDS[field] && v ? MASKED_FIELDS[field]!(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && typeof (v as { toFixed?: unknown }).toFixed === 'function') return String(v); // Prisma Decimal
  const text = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
  return text.length > OBJECT_TEXT_MAX ? `${text.slice(0, OBJECT_TEXT_MAX)}…` : text;
}

/** The fields of `after` that differ from `before`, as from/to pairs. Secret fields are skipped. */
export function diffFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): FieldChanges {
  const changes: FieldChanges = {};
  for (const f of fields) {
    const name = String(f);
    if (SECRET_FIELDS.has(name)) continue;
    const from = auditValue(before[f], name);
    const to = auditValue(after[f], name);
    if (from !== to) changes[name] = { from, to };
  }
  return changes;
}

/** A record's initial values (for a create), in the same shape with `from: null`. Secret fields are skipped. */
export function createdFields(values: Record<string, unknown>): FieldChanges {
  const changes: FieldChanges = {};
  for (const [name, v] of Object.entries(values)) {
    if (SECRET_FIELDS.has(name) || v === undefined) continue;
    changes[name] = { from: null, to: auditValue(v, name) };
  }
  return changes;
}

/** "price 100 → 120; colour Red → Blue" — for an entry's summary. Purchase-cost fields are named, never valued. */
export function changesSummary(changes: FieldChanges, labels: Readonly<Record<string, string>> = {}): string {
  return Object.entries(changes)
    .map(([f, c]) => (COST_FIELDS.has(f) ? `${labels[f] ?? f} changed` : `${labels[f] ?? f} ${c.from ?? '—'} → ${c.to ?? '—'}`))
    .join('; ');
}
