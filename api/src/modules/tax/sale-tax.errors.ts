import { UnprocessableEntityException } from '@nestjs/common';
import { TaxEngineError } from './tax.errors';

/**
 * Why a GST invoice could not be produced for a booking. Every one of these is fail-closed: no Sale,
 * no snapshot, and the booking stays unconverted. Engine failures (TaxEngineErrorCode) are surfaced
 * through the same exception with their own code.
 */
export const SaleTaxErrorCode = {
  SUPPLIER_GSTIN_MISSING: 'SUPPLIER_GSTIN_MISSING',
  SUPPLIER_STATE_CODE_MISSING: 'SUPPLIER_STATE_CODE_MISSING',
  CUSTOMER_STATE_CODE_MISSING: 'CUSTOMER_STATE_CODE_MISSING',
  STATE_CODE_INVALID: 'STATE_CODE_INVALID',
  TAX_POINT_UNRESOLVED: 'TAX_POINT_UNRESOLVED',
  VEHICLE_CLASSIFICATION_MISSING: 'VEHICLE_CLASSIFICATION_MISSING',
  ACCESSORY_CLASSIFICATION_MISSING: 'ACCESSORY_CLASSIFICATION_MISSING',
  COMPONENT_MAPPING_MISSING: 'COMPONENT_MAPPING_MISSING',
  /** The booking carries a discount but the company has not recorded how GST treats it. */
  DISCOUNT_POLICY_MISSING: 'DISCOUNT_POLICY_MISSING',
  /** The booking carries an exchange value but the company has not recorded how GST treats it. */
  EXCHANGE_POLICY_MISSING: 'EXCHANGE_POLICY_MISSING',
  /** A pre-tax discount / exchange is larger than the vehicle amount it would be deducted from. */
  ADJUSTMENT_EXCEEDS_VEHICLE_VALUE: 'ADJUSTMENT_EXCEEDS_VEHICLE_VALUE',
  /** accessoriesTotal does not equal the sum of the booking's accessory rows. */
  ACCESSORY_TOTAL_MISMATCH: 'ACCESSORY_TOTAL_MISMATCH',
  /** The booking has a non-zero legacy additive taxAmount, which GST-inclusive extraction cannot absorb. */
  LEGACY_TAX_AMOUNT_PRESENT: 'LEGACY_TAX_AMOUNT_PRESENT',
  /** The calculated lines do not reconcile to the booking's commercial total. */
  COMMERCIAL_TOTAL_MISMATCH: 'COMMERCIAL_TOTAL_MISMATCH',
} as const;
export type SaleTaxErrorCode = (typeof SaleTaxErrorCode)[keyof typeof SaleTaxErrorCode];

/** Plain error (no Nest dependency) thrown by the pure helpers and the line builder. */
export class SaleTaxError extends Error {
  constructor(
    readonly code: SaleTaxErrorCode,
    message: string,
    readonly lineKey?: string,
  ) {
    super(message);
    this.name = 'SaleTaxError';
  }
}

/** HTTP 422 with a machine-readable code in `details` — the single shape callers of the API see. */
export class SaleTaxException extends UnprocessableEntityException {
  readonly code: string;
  readonly lineKey?: string;

  constructor(code: string, message: string, lineKey?: string) {
    super({ message, details: { code, ...(lineKey !== undefined ? { lineKey } : {}) } });
    this.code = code;
    this.lineKey = lineKey;
  }
}

/** Converts a SaleTaxError / TaxEngineError into the HTTP exception; anything else is rethrown untouched. */
export function toSaleTaxException(e: unknown): unknown {
  if (e instanceof SaleTaxError || e instanceof TaxEngineError) {
    return new SaleTaxException(e.code, `GST invoice could not be generated: ${e.message}`, e.lineKey);
  }
  return e;
}
