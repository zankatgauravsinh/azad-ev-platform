import { csvUnitRowSchema, type CsvImportIssue, type CsvImportPreview, type CsvImportPreviewRow, type CsvImportPreviewUnit } from '@azad/shared';
import { rupeesToPaise } from '../../common/utils/money';
import {
  alreadyExistsMessage,
  unavailableMessage,
  CsvRowError,
  csvStatus,
  IDENTIFIER_FIELDS,
  IDENTIFIER_LABELS,
  issueField,
  issueMessage,
  parseCsvDate,
  resolveCsvVariant,
  resolveCsvVendor,
  type Catalogue,
  type CatalogueVariant,
  type CatalogueVendor,
  type CsvSourceRow,
  type IdentifierField,
} from './csv-import';

/*
 * M4D.2 / M4D.3 — CSV validation, as a pure function: every row is checked with exactly the M4D.1 rules
 * (schema, status, date, catalogue match), plus duplicates within the file and against identifiers already
 * in use. The preview shows the result; the import runs the SAME function inside its transaction and
 * creates `units` only when every row is valid. Nothing here reads or writes the database: the caller
 * supplies the catalogue and the identifiers that already exist.
 */

/** Who already uses an identifier value: the company itself (deleted scooters included) or someone else. */
export interface UsedIdentifier {
  own: boolean;
  deleted: boolean;
}
/** Identifier values already used by a scooter, per field (trimmed, upper-case — how they are stored). */
export type ExistingIdentifiers = Record<IdentifierField, Map<string, UsedIdentifier>>;

/** Everything the import writes for one valid row (money in paise). */
export interface ImportableUnit {
  line: number;
  variantId: string;
  vin: string;
  motorNumber: string;
  batteryNumber: string;
  sellingPrice: bigint;
  purchaseCost: bigint;
  purchaseDate: Date | null;
  supplier: string | null;
  vendorId: string | null;
  location: string | null;
}

const normaliseIdentifier = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toUpperCase();
  return value === '' ? null : value;
};
const text = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');

/** The identifier values the file mentions, to look up in one query. */
export function identifierCandidates(rows: CsvSourceRow[]): Record<IdentifierField, string[]> {
  const out = { vin: new Set<string>(), motorNumber: new Set<string>(), batteryNumber: new Set<string>() };
  for (const { record } of rows) {
    for (const field of IDENTIFIER_FIELDS) {
      const value = normaliseIdentifier(record[field]);
      if (value) out[field].add(value);
    }
  }
  return { vin: [...out.vin], motorNumber: [...out.motorNumber], batteryNumber: [...out.batteryNumber] };
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const plural = (lines: number[]): string => (lines.length === 1 ? `line ${lines[0]}` : `lines ${lines.join(', ')}`);

/** The preview only. `existing` must hold the matches for identifierCandidates(rows). */
export function buildCsvPreview(rows: CsvSourceRow[], catalogue: Catalogue, existing: ExistingIdentifiers, maxRows: number, checkedAt: Date, fileSha256: string, today?: string): CsvImportPreview {
  return validateCsvFile(rows, catalogue, existing, maxRows, checkedAt, fileSha256, today).preview;
}

/**
 * Validates the file. `units` holds what the import would create — one per row, in file order — and is
 * only meaningful when `preview.summary.invalid` is 0. `today` (the company's calendar date, 'YYYY-MM-DD')
 * refuses a purchase date in the future.
 */
export function validateCsvFile(
  rows: CsvSourceRow[], catalogue: Catalogue, existing: ExistingIdentifiers, maxRows: number, checkedAt: Date, fileSha256: string, today?: string,
): { preview: CsvImportPreview; units: ImportableUnit[] } {
  const units: ImportableUnit[] = [];
  // Which lines use each identifier value, per field.
  const linesByValue: Record<IdentifierField, Map<string, number[]>> = { vin: new Map(), motorNumber: new Map(), batteryNumber: new Map() };
  for (const { line, record } of rows) {
    for (const field of IDENTIFIER_FIELDS) {
      const value = normaliseIdentifier(record[field]);
      if (value) linesByValue[field].set(value, [...(linesByValue[field].get(value) ?? []), line]);
    }
  }
  const modelsById = new Map(catalogue.models.map((m) => [m.id, m]));

  const previewRows: CsvImportPreviewRow[] = rows.map(({ line, record }) => {
    const issues: CsvImportIssue[] = [];
    const add = (issue: CsvImportIssue): void => {
      if (!issues.some((i) => i.code === issue.code && i.field === issue.field && i.message === issue.message)) issues.push(issue);
    };
    const check = (fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        if (!(error instanceof CsvRowError)) throw error;
        add({ code: error.code, field: error.field, message: error.message });
      }
    };

    // 1. Values (the shared row schema — exactly what the import parses).
    const parsed = csvUnitRowSchema.safeParse(record);
    if (!parsed.success) for (const issue of parsed.error.issues) add({ code: 'INVALID_VALUE', field: issueField(issue), message: issueMessage(issue) });
    // 2. Status, 3. purchase date — checked even when another value is wrong, so every problem is listed.
    check(() => csvStatus(record.status));
    let purchaseDate: Date | null = null;
    if (text(record.purchaseDate) !== '') check(() => { purchaseDate = parseCsvDate(record.purchaseDate!); });
    const bought = purchaseDate as Date | null;
    if (bought && today && bought.toISOString().slice(0, 10) > today) {
      add({ code: 'INVALID_DATE', field: 'purchaseDate', message: `Purchase date ${bought.toISOString().slice(0, 10).split('-').reverse().join('/')} is in the future.` });
    }
    // 4. Catalogue — needs the three names (a missing one is already reported above).
    let variant: CatalogueVariant | null = null;
    const names = { brand: text(record.brand), model: text(record.model), variant: text(record.variant), colour: text(record.colour) };
    if (names.model && names.variant && names.colour) check(() => { variant = resolveCsvVariant(catalogue, names); });
    let vendor: CatalogueVendor | null = null;
    check(() => { vendor = resolveCsvVendor(catalogue, typeof record.supplier === 'string' ? record.supplier : undefined); });
    // 5. Identifiers: used by another row of this file (every row involved is invalid), or already in use.
    for (const field of IDENTIFIER_FIELDS) {
      const value = normaliseIdentifier(record[field]);
      if (!value) continue;
      const others = (linesByValue[field].get(value) ?? []).filter((l) => l !== line);
      if (others.length > 0) {
        add({ code: 'DUPLICATE_IN_FILE', field, message: `${IDENTIFIER_LABELS[field]} "${value}" also appears on ${plural(others)} of this file — each scooter must be listed once.` });
      }
      const used = existing[field].get(value);
      if (used?.own) add({ code: 'ALREADY_EXISTS', field, message: alreadyExistsMessage(field, value, used.deleted) });
      else if (used) add({ code: 'IDENTIFIER_UNAVAILABLE', field, message: unavailableMessage(field, value) });
    }

    const vin = normaliseIdentifier(record.vin);
    if (issues.length > 0 || !parsed.success || !variant) return { row: line, status: 'INVALID', vin, issues, unit: null };
    const data = parsed.data;
    const matched = variant as CatalogueVariant;
    const model = modelsById.get(matched.modelId)!;
    const unit: CsvImportPreviewUnit = {
      modelId: model.id,
      variantId: matched.id,
      brand: model.brand,
      model: model.name,
      variant: matched.name,
      colour: matched.colour,
      status: 'AVAILABLE',
      sellingPrice: (data.sellingPrice !== undefined ? rupeesToPaise(data.sellingPrice) : matched.exShowroomPrice).toString(),
      sellingPriceSource: data.sellingPrice !== undefined ? 'FILE' : 'LIST_PRICE',
      purchaseCost: rupeesToPaise(data.purchaseCost).toString(),
      purchaseDate: purchaseDate ? isoDate(purchaseDate) : null,
      vendorName: (vendor as CatalogueVendor | null)?.name ?? null,
    };
    units.push({
      line,
      variantId: matched.id,
      vin: data.vin,
      motorNumber: data.motorNumber,
      batteryNumber: data.batteryNumber,
      sellingPrice: BigInt(unit.sellingPrice),
      purchaseCost: BigInt(unit.purchaseCost),
      purchaseDate,
      // The supplier text follows the vendor's name (kept for lists and exports).
      supplier: (vendor as CatalogueVendor | null)?.name ?? (data.supplier || null),
      vendorId: (vendor as CatalogueVendor | null)?.id ?? null,
      location: data.location || null,
    });
    return { row: line, status: 'VALID', vin, issues: [], unit };
  });

  const valid = previewRows.filter((r) => r.status === 'VALID').length;
  const preview: CsvImportPreview = {
    checkedAt: checkedAt.toISOString(),
    fileSha256,
    maxRows,
    summary: {
      total: previewRows.length,
      valid,
      invalid: previewRows.length - valid,
      duplicate: previewRows.filter((r) => r.issues.some((i) => i.code === 'DUPLICATE_IN_FILE' || i.code === 'ALREADY_EXISTS' || i.code === 'IDENTIFIER_UNAVAILABLE')).length,
    },
    rows: previewRows,
  };
  return { preview, units };
}
