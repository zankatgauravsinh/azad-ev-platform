import { SaleTaxError, SaleTaxErrorCode } from './sale-tax.errors';
import { SupplyType } from './tax.types';

/**
 * Supply-type resolution for a sale. Pure — no database, no Nest.
 *
 * The ONLY inputs are the two recorded GST state codes. Nothing is inferred from a free-text state,
 * an address, a phone number or a pincode. A customer with no recorded state code buys at the showroom: goods
 * sold over the counter are supplied where they are handed over (IGST Act s.10(1)(a)/(c)), so the place of
 * supply is the showroom's state — an intra-state sale (owner's decision, 2026-10-22). A malformed code, or a
 * missing company code, still fails closed.
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
  if (!STATE_CODE.test(supplier)) throw new SaleTaxError(SaleTaxErrorCode.STATE_CODE_INVALID, `the company GST state code "${supplier}" is not a two-digit code`);
  if (customer === '') return { supplyType: SupplyType.INTRA, supplierStateCode: supplier, placeOfSupplyStateCode: supplier };
  if (!STATE_CODE.test(customer)) throw new SaleTaxError(SaleTaxErrorCode.STATE_CODE_INVALID, `the customer GST state code "${customer}" is not a two-digit code`);
  return {
    supplyType: supplier === customer ? SupplyType.INTRA : SupplyType.INTER,
    supplierStateCode: supplier,
    placeOfSupplyStateCode: customer,
  };
}
