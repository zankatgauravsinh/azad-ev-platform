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
