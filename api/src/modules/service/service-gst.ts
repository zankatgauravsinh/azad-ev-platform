import { gstinStateCode } from '@azad/shared';

/** Who and where a service bill is for — as billed (stored on the job card, so later edits keep it). */
export interface ServiceGstContext {
  companyStateCode: string | null;
  /** The buyer's GSTIN when valid — B2B. */
  buyerGstin: string | null;
  labourSacCode: string | null;
  partsHsnCode: string | null;
}

export interface ServiceBillGst {
  taxable: bigint;
  partsTaxable: bigint;
  labourTaxable: bigint;
  taxAmount: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  placeOfSupplyStateCode: string | null;
  buyerGstin: string | null;
  partsHsnCode: string | null;
  labourSacCode: string | null;
  total: bigint;
}

/**
 * GST of a service bill, added on top of parts + labour − discount (paise). The discount is shared between
 * parts and labour in proportion, so each is reported under its own HSN / SAC. Tax is rounded half-up to the
 * paisa. Place of supply: the workshop's state, unless a registered buyer in another state is billed (B2B) —
 * then IGST and the buyer's state (IGST Act s.12(2)(a)).
 */
export function serviceBillGst(partsTotal: bigint, labourTotal: bigint, discount: bigint, rateBp: number, ctx: ServiceGstContext): ServiceBillGst {
  const gross = partsTotal + labourTotal;
  const taxable = gross - discount > 0n ? gross - discount : 0n;
  const partsTaxable = gross > 0n ? (taxable * partsTotal) / gross : 0n;
  const labourTaxable = taxable - partsTaxable;
  const taxAmount = (taxable * BigInt(rateBp) + 5_000n) / 10_000n;
  const buyerState = gstinStateCode(ctx.buyerGstin);
  const inter = Boolean(ctx.buyerGstin && buyerState && ctx.companyStateCode && buyerState !== ctx.companyStateCode);
  const cgst = inter ? 0n : taxAmount / 2n;
  return {
    taxable,
    partsTaxable,
    labourTaxable,
    taxAmount,
    cgst,
    sgst: inter ? 0n : taxAmount - cgst,
    igst: inter ? taxAmount : 0n,
    placeOfSupplyStateCode: inter ? buyerState : ctx.companyStateCode,
    buyerGstin: ctx.buyerGstin,
    partsHsnCode: partsTotal > 0n ? ctx.partsHsnCode : null,
    labourSacCode: labourTotal > 0n ? ctx.labourSacCode : null,
    total: taxable + taxAmount,
  };
}
