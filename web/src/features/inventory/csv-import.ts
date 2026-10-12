import axios from 'axios';
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS, type ApiError, type CsvImportField } from '@azad/shared';
import type { ModelRef, VariantOption } from './api';

/*
 * M4D.4 — CSV import helpers for the import dialog: the documented columns, a template built from the
 * company's active catalogue, and how a failed request is presented. The server stays authoritative:
 * nothing here decides whether a row is valid.
 */

export interface CsvColumnDoc {
  header: string;
  field: CsvImportField;
  required: boolean;
  help: string;
}

/** Every column the import reads, in template order (headers are matched ignoring case and spaces). */
export const CSV_COLUMNS: CsvColumnDoc[] = [
  { header: 'Brand', field: 'brand', required: false, help: 'Only needed when two brands use the same model name.' },
  { header: 'Model', field: 'model', required: true, help: 'Must already exist and be active under Inventory → Models.' },
  { header: 'Variant', field: 'variant', required: true, help: 'Must already exist and be active for that model.' },
  { header: 'Colour', field: 'colour', required: true, help: "The variant's colour, as in the catalogue." },
  { header: 'VIN', field: 'vin', required: true, help: 'Unique — not used by any other scooter.' },
  { header: 'Motor Number', field: 'motorNumber', required: true, help: 'Unique.' },
  { header: 'Battery Number', field: 'batteryNumber', required: true, help: 'Unique.' },
  { header: 'Purchase Date', field: 'purchaseDate', required: false, help: 'YYYY-MM-DD, D/M/YYYY or DD/MM/YYYY. Dates with slashes are day first: 3/12/2026 is 3 December 2026.' },
  { header: 'Purchase Cost', field: 'purchaseCost', required: false, help: 'Rupees, digits only (no commas or ₹). Blank means 0.' },
  { header: 'Selling Price', field: 'sellingPrice', required: false, help: "Rupees, digits only. Blank takes the variant's list price; 0 is kept as 0." },
  { header: 'Supplier', field: 'supplier', required: false, help: 'Free text.' },
  { header: 'Location', field: 'location', required: false, help: 'Where the scooter is kept, e.g. a showroom bay.' },
  { header: 'Status', field: 'status', required: false, help: 'Leave blank or write AVAILABLE — imported scooters are always Available; any other status is refused.' },
];

export const CSV_FIELD_LABELS: Record<CsvImportField, string> = Object.fromEntries(CSV_COLUMNS.map((c) => [c.field, c.header])) as Record<CsvImportField, string>;

/** The general rules shown with the column list. */
export const CSV_RULES: string[] = [
  'Names are matched ignoring capital letters and extra spaces. Nothing is added to the catalogue — add missing models or variants under Inventory → Models first.',
  `At most ${CSV_IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows and ${CSV_IMPORT_MAX_BYTES / (1024 * 1024)} MB per file.`,
  'All or nothing: if any row has a problem, no scooter is imported. Fix the file and preview it again.',
];

/** One CSV cell: quoted when it contains a comma, quote or line break. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The template: the header, then one row per ACTIVE variant of an ACTIVE model with Brand / Model /
 * Variant / Colour filled in and everything else blank — copy a row per scooter and fill in its numbers.
 * Rows left without numbers are reported by the preview, never imported.
 */
export function buildCsvTemplate(models: ModelRef[], variants: VariantOption[]): string {
  const activeModels = new Set(models.map((m) => m.id));
  const rows = variants
    .filter((v) => v.isActive !== false && activeModels.has(v.model.id))
    .map((v) => [v.model.brand, v.model.name, v.name, v.colour])
    .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
  const blanks = CSV_COLUMNS.length - 4;
  return [CSV_COLUMNS.map((c) => c.header).join(','), ...rows.map((r) => [...r.map(csvCell), ...Array<string>(blanks).fill('')].join(','))].join('\r\n') + '\r\n';
}

/** Reads a file's bytes once, so the preview and the import send exactly the same bytes. */
export function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

/** A SHA-256 in hex, as the preview returns it — the only value ever sent as expectedSha256. */
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);

/** Why a request did not give a usable answer. */
export type CsvRequestFailure =
  /** The server answered and nothing was imported (bad file, too big, no permission…). */
  | { kind: 'failed'; message: string }
  /** 409 — the file, the inventory or the catalogue changed: preview again. */
  | { kind: 'conflict'; message: string }
  /** 503 — the server could not finish within its deadline. */
  | { kind: 'deadline'; message: string }
  /** No (trustworthy) answer: network failure, gateway error, server error — the import may or may not have happened. */
  | { kind: 'unknown'; message: string };

const serverMessage = (data: unknown): string | null => {
  const message = (data as Partial<ApiError> | undefined)?.message;
  return typeof message === 'string' && message ? message : null;
};

/** The body is the API's own JSON error (not, say, a gateway's HTML page) for this status. */
const isApiError = (data: unknown, status: number): boolean =>
  typeof data === 'object' && data !== null && (data as Partial<ApiError>).statusCode === status && serverMessage(data) !== null;

/** How a failed preview or import request is presented. `importing`: a commit was attempted. */
export function describeCsvFailure(error: unknown, importing: boolean): CsvRequestFailure {
  const unknown = (why: string): CsvRequestFailure => importing
    ? { kind: 'unknown', message: why }
    : { kind: 'failed', message: `${why} Nothing was imported — choose the file again to retry the preview.` };
  if (axios.isCancel(error)) return unknown('The request was cancelled before the server answered.');
  if (!axios.isAxiosError(error)) return unknown('The request did not complete.');
  const status = error.response?.status;
  if (!error.response || status === undefined) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      const ms = Number(error.config?.timeout);
      return unknown(`The server did not answer within ${ms > 0 ? `${Math.round(ms / 1000)} seconds` : 'the time allowed'}.`);
    }
    return unknown('The connection failed before the server answered.');
  }
  const message = serverMessage(error.response.data);
  if (status === 401) return { kind: 'failed', message: 'Your session has expired — sign in again, then choose the file again.' };
  if (status === 403) return { kind: 'failed', message: 'You do not have permission to import scooters.' };
  if (status === 413) return { kind: 'failed', message: `The file is larger than ${CSV_IMPORT_MAX_BYTES / (1024 * 1024)} MB — split it into smaller files.` };
  if (status === 409) return { kind: 'conflict', message: message ?? 'The file or the inventory changed.' };
  // Only the API's own 503 is its "could not finish in time" answer; a 503 from anything in between proves nothing.
  if (status === 503 && isApiError(error.response.data, 503)) return importing
    ? { kind: 'deadline', message: message ?? 'The server could not finish in time.' }
    : { kind: 'failed', message: 'The server is busy — choose the file again to retry the preview.' };
  if (status === 503) return unknown('A gateway reported the service unavailable (HTTP 503).');
  if (status >= 500) return unknown(status === 502 || status === 504 ? `The server did not answer in time (HTTP ${status}).` : `The server reported an error (HTTP ${status}).`);
  return { kind: 'failed', message: message ?? `The request was refused (HTTP ${status}).` };
}
