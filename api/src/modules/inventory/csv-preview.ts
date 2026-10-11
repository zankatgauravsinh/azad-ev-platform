import { csvUnitRowSchema, type CsvImportIssue, type CsvImportPreview, type CsvImportPreviewRow, type CsvImportPreviewUnit } from '@azad/shared';
import { rupeesToPaise } from '../../common/utils/money';
import {
  alreadyExistsMessage,
  CsvRowError,
  csvStatus,
  IDENTIFIER_FIELDS,
  IDENTIFIER_LABELS,
  issueField,
  issueMessage,
  parseCsvDate,
  resolveCsvVariant,
  type Catalogue,
  type CatalogueVariant,
  type CsvSourceRow,
  type IdentifierField,
} from './csv-import';

/*
 * M4D.2 — the CSV import preview, as a pure function: every row is checked with exactly the M4D.1 rules
 * (schema, status, date, catalogue match), plus duplicates within the file and against identifiers already
 * in use. Nothing here reads or writes the database; the caller supplies the catalogue and the identifiers
 * that already exist.
 */

/** Identifier values already used by a scooter, per field (trimmed, upper-case — how they are stored). */
export type ExistingIdentifiers = Record<IdentifierField, Set<string>>;

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

/** Builds the preview. `existing` must hold the matches for identifierCandidates(rows). */
export function buildCsvPreview(rows: CsvSourceRow[], catalogue: Catalogue, existing: ExistingIdentifiers, maxRows: number, checkedAt: Date): CsvImportPreview {
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
    // 4. Catalogue — needs the three names (a missing one is already reported above).
    let variant: CatalogueVariant | null = null;
    const names = { brand: text(record.brand), model: text(record.model), variant: text(record.variant), colour: text(record.colour) };
    if (names.model && names.variant && names.colour) check(() => { variant = resolveCsvVariant(catalogue, names); });
    // 5. Identifiers: used by another row of this file (every row involved is invalid), or already in use.
    for (const field of IDENTIFIER_FIELDS) {
      const value = normaliseIdentifier(record[field]);
      if (!value) continue;
      const others = (linesByValue[field].get(value) ?? []).filter((l) => l !== line);
      if (others.length > 0) {
        add({ code: 'DUPLICATE_IN_FILE', field, message: `${IDENTIFIER_LABELS[field]} "${value}" also appears on ${plural(others)} of this file — each scooter must be listed once.` });
      }
      if (existing[field].has(value)) add({ code: 'ALREADY_EXISTS', field, message: alreadyExistsMessage(field, value) });
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
    };
    return { row: line, status: 'VALID', vin, issues: [], unit };
  });

  const valid = previewRows.filter((r) => r.status === 'VALID').length;
  return {
    checkedAt: checkedAt.toISOString(),
    maxRows,
    summary: {
      total: previewRows.length,
      valid,
      invalid: previewRows.length - valid,
      duplicate: previewRows.filter((r) => r.issues.some((i) => i.code === 'DUPLICATE_IN_FILE' || i.code === 'ALREADY_EXISTS')).length,
    },
    rows: previewRows,
  };
}
