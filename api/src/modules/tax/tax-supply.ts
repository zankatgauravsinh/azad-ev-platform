import { SaleTaxError, SaleTaxErrorCode } from './sale-tax.errors';
import { SupplyType } from './tax.types';

/**
 * Supply-type resolution for a sale. Pure — no database, no Nest.
 *
 * The ONLY inputs are the two recorded GST state codes. Nothing is inferred from a free-text state,
 * an address, a phone number or a pincode, and there is no fallback: if either code is missing or
 * malformed the resolution fails closed. What should happen for a customer with no recorded state is
 * an open CA/business rule — until it is decided, such a sale cannot be GST-invoiced.
 */
const STATE_CODE = /^\d{2}$/; // GST state codes are two digits (the first two characters of a GSTIN)

export interface SupplyContext {
  supplyType: SupplyType;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
}

export function resolveSupplyContext(supplierStateCode: string | null | undefined, customerStateCode: string | null | undefined): SupplyContext {
  const supplier = supplierStateCode?.trim() ?? '';
  const customer = customerStateCode?.trim() ?? '';
  if (supplier === '') throw new SaleTaxError(SaleTaxErrorCode.SUPPLIER_STATE_CODE_MISSING, 'the company GST state code is not set');
  if (customer === '') throw new SaleTaxError(SaleTaxErrorCode.CUSTOMER_STATE_CODE_MISSING, 'the customer GST state code is not set');
  if (!STATE_CODE.test(supplier)) throw new SaleTaxError(SaleTaxErrorCode.STATE_CODE_INVALID, `the company GST state code "${supplier}" is not a two-digit code`);
  if (!STATE_CODE.test(customer)) throw new SaleTaxError(SaleTaxErrorCode.STATE_CODE_INVALID, `the customer GST state code "${customer}" is not a two-digit code`);
  return {
    supplyType: supplier === customer ? SupplyType.INTRA : SupplyType.INTER,
    supplierStateCode: supplier,
    placeOfSupplyStateCode: customer,
  };
}
