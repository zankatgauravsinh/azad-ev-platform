import { z } from 'zod';

/*
 * GST returns: the facts the GST module, invoices and exports share. Rules are summarised in the project skill
 * `.claude/skills/gst-india`; thresholds that change by notification live here so they change in one place.
 */

/** GST state / UT codes with the names the GST Offline Tool expects ("24-Gujarat"). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** "24-Gujarat" — a place of supply as the returns write it; the bare code when it is unknown. */
export function gstPlaceOfSupply(code: string | null | undefined): string {
  if (!code) return '';
  const name = GST_STATES[code];
  return name ? `${code}-${name}` : code;
}

/** The state code a GSTIN belongs to (its first two digits), or null. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  return gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

/**
 * Seeded expense categories whose GST is a blocked credit (CGST Act s.17(5)) — food and beverages. Every other
 * category is eligible by default; the owner can change any category, and any single bill, in the app.
 */
export const BLOCKED_CREDIT_CATEGORIES: readonly string[] = ['Tea & Snacks'];

/**
 * GSTR-1 Table 5 (B2CL): an INTER-state invoice to an unregistered buyer above this value (paise) is reported
 * invoice by invoice. ₹1,00,000 since 1 Aug 2024 (was ₹2,50,000).
 */
export const B2CL_THRESHOLD_PAISE = 10_000_000n;

// ── GST returns: one month of data ─────────────────────────────────────────────────────────────────────────


/** A return period, 'YYYY-MM' (the month of the invoice / note / bill date, company time zone). */
export const gstPeriodQuerySchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });
export type GstPeriodQuery = z.infer<typeof gstPeriodQuerySchema>;

export const GstSeries = { SCOOTER: 'SCOOTER', ACCESSORY: 'ACCESSORY', SERVICE: 'SERVICE', CREDIT_NOTE: 'CREDIT_NOTE' } as const;
export type GstSeries = (typeof GstSeries)[keyof typeof GstSeries];
export const GST_SERIES_LABEL: Record<GstSeries, string> = { SCOOTER: 'Scooter tax invoices', ACCESSORY: 'Accessory invoices', SERVICE: 'Service bills', CREDIT_NOTE: 'Credit notes' };

/** Where a document goes in GSTR-1. */
export const GstSection = { B2B: 'B2B', B2CL: 'B2CL', B2CS: 'B2CS', CDNR: 'CDNR', CDNUR: 'CDNUR' } as const;
export type GstSection = (typeof GstSection)[keyof typeof GstSection];

/** INVOICE; CREDIT_NOTE; CANCELLATION = an invoice of an earlier month cancelled in this one (reduces B2CS). */
export type GstDocumentKind = 'INVOICE' | 'CREDIT_NOTE' | 'CANCELLATION';

/** Money as paise strings. */
export interface GstTaxHeads { taxable: string; igst: string; cgst: string; sgst: string }

export interface GstLineDto extends GstTaxHeads {
  code: string | null;
  codeType: 'HSN' | 'SAC' | null;
  description: string;
  /** Unit quantity code (NOS for goods, NA for services). */
  uqc: string;
  quantity: number;
  /** e.g. 5, 18; null for nil-rated / exempt lines. */
  ratePercent: number | null;
  treatment: 'TAXABLE' | 'EXEMPT' | 'NIL_RATED';
}

export interface GstDocumentDto extends GstTaxHeads {
  /** The source record's id (sale, accessory sale, job card, credit note). */
  id: string;
  kind: GstDocumentKind;
  series: GstSeries;
  number: string;
  /** 'YYYY-MM-DD' */
  date: string;
  buyerName: string;
  buyerGstin: string | null;
  placeOfSupply: string | null;
  supplyType: 'INTRA' | 'INTER';
  /** Null when the document is not reported (cancelled in its own month). */
  section: GstSection | 'B2CS_REDUCTION' | null;
  /** The document's total value (what the customer pays / is credited), paise. */
  value: string;
  cancelled: boolean;
  /** For a credit note / cancellation: the invoice it relates to. */
  original: { number: string; date: string } | null;
  /** Where to open it in the app. */
  link: { type: 'booking' | 'accessorySale' | 'serviceJob' | 'return'; id: string };
  lines: GstLineDto[];
}

export interface Gstr1InvoiceRow extends GstTaxHeads {
  number: string;
  date: string;
  buyerGstin: string | null;
  buyerName: string;
  value: string;
  placeOfSupply: string;
  ratePercent: number;
}
export interface Gstr1NoteRow extends Gstr1InvoiceRow {
  noteType: 'C' | 'D';
  original: { number: string; date: string } | null;
}
export interface Gstr1B2csRow extends GstTaxHeads { placeOfSupply: string; ratePercent: number }
export interface GstHsnRow extends GstTaxHeads { code: string; description: string; uqc: string; quantity: number; ratePercent: number; totalValue: string }
export interface GstDocumentsIssuedRow { series: GstSeries; nature: string; from: string; to: string; total: number; cancelled: number }
export interface GstNilExemptRow { description: string; nil: string; exempt: string; nonGst: string }

export interface Gstr1Dto {
  period: string;
  b2b: Gstr1InvoiceRow[];
  b2cl: Gstr1InvoiceRow[];
  b2cs: Gstr1B2csRow[];
  cdnr: Gstr1NoteRow[];
  cdnur: Gstr1NoteRow[];
  hsnB2b: GstHsnRow[];
  hsnB2c: GstHsnRow[];
  documents: GstDocumentsIssuedRow[];
  nilExempt: GstNilExemptRow[];
  /** Net of credit notes and cancellations. */
  totals: GstTaxHeads;
}

export interface GstHeads { igst: string; cgst: string; sgst: string }

export interface Gstr3bDto {
  period: string;
  /** 3.1(a) outward taxable supplies, net of credit notes; includes other income carrying GST. */
  outwardTaxable: GstTaxHeads;
  /** 3.1(c) nil-rated / exempt. */
  outwardNilExempt: string;
  /** 3.2 inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: { placeOfSupply: string; taxable: string; igst: string }[];
  /** Other income with GST (no invoice detail) — part of 3.1(a), not of GSTR-1. */
  otherIncome: GstTaxHeads;
  itc: {
    /** 4(A)(5) all other ITC — bills with the supplier's GSTIN. */
    available: GstHeads;
    /** 4(B)(1) reversed — blocked credits (s.17(5)). */
    reversed: GstHeads;
    /** 4(C) net ITC available. */
    net: GstHeads;
    /** GST on bills without the supplier's GSTIN: not in GSTR-2B, not claimable. */
    notClaimable: GstHeads;
  };
  /** 6.1: output tax, ITC used against it (IGST credit first), and the cash to pay per head. */
  payment: { liability: GstHeads; itcUsed: GstHeads; cash: GstHeads };
}

export type GstInwardSource = 'SCOOTER' | 'ACCESSORY_PURCHASE' | 'EXPENSE';
export interface GstInwardRowDto extends GstTaxHeads {
  id: string;
  source: GstInwardSource;
  /** Our reference (VIN, purchase number, expense number). */
  reference: string;
  billNumber: string | null;
  billDate: string;
  vendorName: string | null;
  vendorGstin: string | null;
  supplyType: 'INTRA' | 'INTER';
  /** ELIGIBLE → 4(A)(5); BLOCKED → also 4(B)(1); NO_GSTIN → not claimable. */
  itc: 'ELIGIBLE' | 'BLOCKED' | 'NO_GSTIN';
  paid: boolean;
}

export type GstIssueSeverity = 'ERROR' | 'WARNING' | 'INFO';
export interface GstIssueDto {
  code: string;
  severity: GstIssueSeverity;
  message: string;
  /** The document it is about, when there is one. */
  reference: string | null;
  link: { type: 'booking' | 'accessorySale' | 'serviceJob' | 'return' | 'customer' | 'vendor' | 'inventory' | 'expense' | 'accessoryPurchase'; id: string } | null;
}

export interface GstOverviewDto {
  period: string;
  gstr1: { documents: number; totals: GstTaxHeads };
  gstr3b: Gstr3bDto;
  issues: { errors: number; warnings: number; info: number };
}
