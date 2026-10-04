/**
 * Typed, fail-closed failures of the tax engine. Plain Error subclass (no Nest dependency) so the pure
 * math layer can throw it; a future caller maps `code` to whatever HTTP/business response it needs.
 * The engine never falls back to a default or zero rate — it throws one of these instead.
 */
export const TaxEngineErrorCode = {
  /** Classification id is unknown, archived (soft-deleted), or belongs to another company. */
  CLASSIFICATION_NOT_FOUND: 'CLASSIFICATION_NOT_FOUND',
  CLASSIFICATION_INACTIVE: 'CLASSIFICATION_INACTIVE',
  /** A TAXABLE classification has no active rate covering the requested calendar date. */
  NO_RATE_FOR_DATE: 'NO_RATE_FOR_DATE',
  /** More than one active rate covers the date (configuration should prevent this; defensive). */
  AMBIGUOUS_RATE: 'AMBIGUOUS_RATE',
  /** A TAXABLE classification has no HSN/SAC code. */
  TAXABLE_WITHOUT_CODE: 'TAXABLE_WITHOUT_CODE',
  /** supplyType was not supplied (or is not INTRA / INTER). */
  MISSING_SUPPLY_CONTEXT: 'MISSING_SUPPLY_CONTEXT',
  /** Amount is negative, non-integer, or not safely representable as paise. */
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  /** The company has GST switched off (CompanySetting.gstEnabled = false, or no settings row). */
  GST_DISABLED: 'GST_DISABLED',
  /** A rate value is malformed or outside 0–100% with at most 2 decimals. */
  INVALID_RATE: 'INVALID_RATE',
  /** Structurally invalid request: bad asOf, pricing mode, line keys, empty lines, or tenant scope. */
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const;
export type TaxEngineErrorCode = (typeof TaxEngineErrorCode)[keyof typeof TaxEngineErrorCode];

export class TaxEngineError extends Error {
  readonly code: TaxEngineErrorCode;
  /** The request line that failed, when the failure is attributable to one. */
  readonly lineKey?: string;

  constructor(code: TaxEngineErrorCode, message: string, lineKey?: string) {
    super(message);
    this.name = 'TaxEngineError';
    this.code = code;
    this.lineKey = lineKey;
  }

  /** The same failure, attributed to a request line (keeps an existing attribution). */
  forLine(lineKey: string): TaxEngineError {
    return this.lineKey !== undefined ? this : new TaxEngineError(this.code, this.message, lineKey);
  }
}
