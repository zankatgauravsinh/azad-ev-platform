import { parse } from 'csv-parse/sync';
import { UNIT_STATUSES, UnitStatus, type CsvImportField, type CsvImportIssueCode } from '@azad/shared';
import type { ZodIssue } from 'zod';

/*
 * M4D.1 — strict CSV import helpers (pure, unit-tested). The import never creates catalogue entries: each
 * row must name an existing, active model and variant of the company. See InventoryService.importCsv.
 */

/** A row the user must fix: its message is safe to show as is; code and field say what kind of problem it is. */
export class CsvRowError extends Error {
  constructor(message: string, readonly code: CsvImportIssueCode = 'INVALID_VALUE', readonly field: CsvImportField | null = null) {
    super(message);
  }
}

// ── Reading ───────────────────────────────────────────────

/** One CSV record with the source line it starts on (header = line 1; blank lines and multi-line cells counted). */
export interface CsvSourceRow {
  line: number;
  record: Record<string, string>;
}

const lineBreaks = (text: string): number => (text.match(/\r\n|\n|\r/g) ?? []).length;

/**
 * Parses the file into records, each with the line it starts on. Blank lines are skipped but still
 * counted, a quoted cell may span lines, and LF / CRLF / CR endings and a UTF-8 byte-order mark are all
 * handled. A malformed file throws (csv-parse error, with its line).
 */
export function readCsvRows(buffer: Buffer, normaliseHeader: (header: string) => string): CsvSourceRow[] {
  const parsed = parse(buffer, {
    columns: (header: string[]) => header.map(normaliseHeader),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    info: true,
    raw: true,
  }) as { record: Record<string, string>; info: { bytes: number }; raw: string }[];
  return parsed.map(({ record, info, raw }) => {
    // `raw` is the record's source text, preceded by any skipped blank lines; `info.bytes` is where it ends.
    const start = info.bytes - Buffer.byteLength(raw);
    const leadingBlankLines = raw.match(/^(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
    const contentStart = start + Buffer.byteLength(leadingBlankLines);
    return { line: 1 + lineBreaks(buffer.subarray(0, contentStart).toString('utf8')), record };
  });
}

/** A safe message for a file that cannot be parsed at all (no row was imported). */
export function csvParseMessage(error: unknown): string {
  const line = (error as { lines?: unknown })?.lines;
  return typeof line === 'number' ? `Could not read the CSV file: the problem is at line ${line} (check quotes and the number of columns).` : 'Could not read the CSV file.';
}

// ── Field rules ───────────────────────────────────────────

/** Catalogue names compare after trimming, collapsing inner whitespace and ignoring case. */
export const normaliseCatalogueText = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

const DATE_FORMATS = 'YYYY-MM-DD or D/M/YYYY, day first (e.g. 2026-06-01, 1/6/2026 or 01/06/2026)';

/**
 * A purchase date: YYYY-MM-DD, or D/M/YYYY / DD/MM/YYYY (always day first; one or two digits for the day
 * and month, four for the year), nothing else — no general-purpose date parsing. It is a calendar date and is
 * stored as UTC midnight of that day — what the API stores for the unit form's date-only value — so it
 * never shifts with the server's time zone. Impossible dates (31/02/2026) are refused.
 */
export function parseCsvDate(raw: string): Date {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const parts = iso ? { y: iso[1], m: iso[2], d: iso[3] } : dmy ? { y: dmy[3], m: dmy[2], d: dmy[1] } : null;
  if (!parts) throw new CsvRowError(`Purchase date "${value}" is not in a supported format — use ${DATE_FORMATS}.`, 'INVALID_DATE', 'purchaseDate');
  const [y, m, d] = [Number(parts.y), Number(parts.m), Number(parts.d)];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new CsvRowError(`Purchase date "${value}" is not a real date — use ${DATE_FORMATS}.`, 'INVALID_DATE', 'purchaseDate');
  }
  return date;
}

/** Only AVAILABLE units can be imported (blank = AVAILABLE). Every other status is refused per row. */
export function csvStatus(raw: string | undefined): UnitStatus {
  if (!raw || raw.trim() === '') return UnitStatus.AVAILABLE;
  const value = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (value === UnitStatus.AVAILABLE) return UnitStatus.AVAILABLE;
  if ((UNIT_STATUSES as string[]).includes(value)) {
    throw new CsvRowError(`Status "${raw.trim()}" cannot be imported — only AVAILABLE units can be added by CSV (leave Status blank or use AVAILABLE).`, 'STATUS_NOT_ALLOWED', 'status');
  }
  throw new CsvRowError(`Unknown status "${raw.trim()}" — only AVAILABLE units can be added by CSV (leave Status blank or use AVAILABLE).`, 'STATUS_NOT_ALLOWED', 'status');
}

// ── Catalogue matching ────────────────────────────────────

export interface CatalogueModel { id: string; brand: string; name: string; isActive: boolean }
export interface CatalogueVariant { id: string; modelId: string; name: string; colour: string; isActive: boolean; exShowroomPrice: bigint }
export interface Catalogue { models: CatalogueModel[]; variants: CatalogueVariant[] }

const modelLabel = (m: CatalogueModel): string => `${m.brand} ${m.name}`;
const variantLabel = (v: CatalogueVariant): string => `${v.name} / ${v.colour}`;
const MAX_LISTED = 8;
const listOf = (labels: string[]): string => (labels.length > MAX_LISTED ? `${labels.slice(0, MAX_LISTED).join(', ')}, …` : labels.join(', '));

/**
 * The company's active variant a row names. The model is matched by name (and by brand when the row has
 * one); without a brand, exactly one ACTIVE model may match. The variant is matched by name and colour
 * under that model. Nothing is created; unknown, inactive or ambiguous references are row errors.
 */
export function resolveCsvVariant(catalogue: Catalogue, row: { brand?: string; model: string; variant: string; colour: string }): CatalogueVariant {
  const name = normaliseCatalogueText(row.model);
  const brand = row.brand && row.brand.trim() !== '' ? normaliseCatalogueText(row.brand) : null;
  const shown = brand ? `"${row.brand!.trim()} ${row.model.trim()}"` : `"${row.model.trim()}"`;
  const candidates = catalogue.models.filter((m) => normaliseCatalogueText(m.name) === name && (brand === null || normaliseCatalogueText(m.brand) === brand));
  if (candidates.length === 0) {
    throw new CsvRowError(`Model ${shown} was not found — check the ${brand ? 'brand and model' : 'model'} name, or add it under Inventory → Models first.`, 'MODEL_NOT_FOUND', 'model');
  }
  const active = candidates.filter((m) => m.isActive);
  if (active.length === 0) {
    throw new CsvRowError(`Model ${listOf(candidates.map(modelLabel))} is inactive — activate it under Inventory → Models, or use an active model.`, 'MODEL_INACTIVE', 'model');
  }
  if (active.length > 1) {
    throw new CsvRowError(brand
      ? `Model ${shown} matches more than one model (${listOf(active.map(modelLabel))}) — their names differ only in case or spacing; fix them under Inventory → Models.`
      : `Model ${shown} matches more than one model (${listOf(active.map(modelLabel))}) — add a Brand column to choose one.`, 'MODEL_AMBIGUOUS', 'model');
  }
  const model = active[0]!;

  const ofModel = catalogue.variants.filter((v) => v.modelId === model.id);
  const wanted = { name: normaliseCatalogueText(row.variant), colour: normaliseCatalogueText(row.colour) };
  const matches = ofModel.filter((v) => normaliseCatalogueText(v.name) === wanted.name && normaliseCatalogueText(v.colour) === wanted.colour);
  const shownVariant = `"${row.variant.trim()} / ${row.colour.trim()}"`;
  if (matches.length === 0) {
    const available = ofModel.filter((v) => v.isActive).map(variantLabel);
    throw new CsvRowError(`Variant ${shownVariant} was not found for ${modelLabel(model)} — ${available.length > 0 ? `available: ${listOf(available)}` : 'it has no active variants'}. Add it under Inventory → Models first.`, 'VARIANT_NOT_FOUND', 'variant');
  }
  const activeMatches = matches.filter((v) => v.isActive);
  if (activeMatches.length === 0) {
    throw new CsvRowError(`Variant ${listOf(matches.map(variantLabel))} of ${modelLabel(model)} is inactive — activate it under Inventory → Models, or use an active variant.`, 'VARIANT_INACTIVE', 'variant');
  }
  if (activeMatches.length > 1) {
    throw new CsvRowError(`Variant ${shownVariant} matches more than one variant of ${modelLabel(model)} (${listOf(activeMatches.map(variantLabel))}) — their names differ only in case or spacing; fix them under Inventory → Models.`, 'VARIANT_AMBIGUOUS', 'variant');
  }
  return activeMatches[0]!;
}

// ── Messages ──────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  brand: 'Brand', model: 'Model', variant: 'Variant', colour: 'Colour', vin: 'VIN', motorNumber: 'Motor number', batteryNumber: 'Battery number',
  purchaseDate: 'Purchase date', purchaseCost: 'Purchase cost', sellingPrice: 'Selling price', supplier: 'Supplier', location: 'Location', status: 'Status',
};

const FIELDS = new Set(Object.keys(FIELD_LABELS));
/** The CSV column a validation issue is about (null when it is not one of the columns). */
export const issueField = (issue: ZodIssue): CsvImportField | null => {
  const key = String(issue.path[0] ?? '');
  return FIELDS.has(key) ? (key as CsvImportField) : null;
};

/** A validation issue in plain words, naming the column. */
export function issueMessage(issue: ZodIssue): string {
  const label = FIELD_LABELS[String(issue.path[0] ?? '')] ?? String(issue.path.join('.') || 'Value');
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return `${label} is required`;
  if (issue.code === 'invalid_type' && issue.expected === 'number') return `${label} must be a number in rupees (digits only — no commas or ₹)`;
  if (issue.code === 'too_small' && issue.type === 'string') return issue.minimum === 1 ? `${label} is required` : `${label} is too short`;
  if (issue.code === 'too_small') return `${label} cannot be negative`;
  if (issue.code === 'too_big') return `${label} is too long`;
  return `${label}: ${issue.message}`;
}

export type IdentifierField = 'vin' | 'motorNumber' | 'batteryNumber';
export const IDENTIFIER_FIELDS: readonly IdentifierField[] = ['vin', 'motorNumber', 'batteryNumber'];
export const IDENTIFIER_LABELS: Record<IdentifierField, string> = { vin: 'VIN', motorNumber: 'Motor number', batteryNumber: 'Battery number' };

/** Already used by a scooter of the company's own inventory (deleted scooters included). */
export function alreadyExistsMessage(field: IdentifierField, value: string, deleted = false): string {
  const where = deleted ? 'by a deleted scooter in your inventory' : 'by a scooter in your inventory';
  return `${IDENTIFIER_LABELS[field]} "${value}" is already used ${where}.`;
}

/**
 * Registered outside the company. VIN, motor and battery numbers are unique across the whole system, so
 * the number cannot be used — and nothing else about it (company, record) is disclosed.
 */
export function unavailableMessage(field: IdentifierField, value: string): string {
  return `${IDENTIFIER_LABELS[field]} "${value}" is not available — it is already registered and cannot be used.`;
}
