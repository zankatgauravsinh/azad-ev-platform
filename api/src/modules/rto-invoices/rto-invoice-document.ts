import { RTO_SUPPLY_TYPE_LABEL, formatAadhaar, panFromGstin, type RtoSupplyType } from '@azad/shared';
import { formatInrExact } from '../../common/utils/money';
import { rupeesInWords } from '../../common/utils/amount-in-words';

/**
 * The RTO invoice as the plain document its PDF prints — every label and value already worded and formatted.
 * Pure: no database, no PDFKit. Laid out after the dealer's reference vehicle invoice (customer block with
 * Aadhaar / PAN / HPA, vehicle description with chassis / motor / battery / key numbers, amount box with the
 * GST split, amount in words, discount note, signatures, jurisdiction).
 *
 * The figures are the stored ones — nothing is recalculated here. Identity (company, customer, vehicle) is
 * read live, as on the tax invoice.
 */
export interface RtoInvoiceFigures {
  invoiceNumber: string;
  invoiceDate: Date;
  listPrice: bigint;
  discount: bigint;
  sellingPrice: bigint;
  gstRateBp: number;
  supplyType: RtoSupplyType;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  gstAmount: bigint;
  total: bigint;
  hsnCode: string | null;
  policyNumber: string | null;
  /** 'YYYY-MM-DD' — the date printed, stored on the invoice. */
  deliveryDate: string | null;
  revision: number;
}

export interface RtoInvoiceIdentity {
  dealer: { name: string; gstin: string | null; state: string | null; stateCode: string | null; city: string | null };
  customer: {
    name: string;
    phone: string;
    address: string | null;
    village: string | null;
    city: string | null;
    tehsil: string | null;
    district: string | null;
    state: string | null;
    pin: string | null;
    aadhaarNumber: string | null;
    panNumber: string | null;
    gstin: string | null;
  };
  /** The lender the vehicle is hypothecated to, or null when bought outright (printed as SELF). */
  financeCompany: string | null;
  vehicle: { make: string; model: string; variant: string; colour: string; vin: string; motorNumber: string; batteryNumber: string; keyNumber: string | null };
  preparedBy: string | null;
  timeZone: string;
}

export interface Row {
  label: string;
  value: string;
}

export interface RtoInvoiceDocument {
  title: 'TAX INVOICE';
  invoiceNumber: string;
  invoiceDate: string;
  /** Under the letterhead: the dealer's GSTIN, state and PAN. */
  dealerLine: string;
  customer: Row[];
  references: Row[];
  vehicle: Row[];
  /** Basic price, the GST lines, total — in print order. */
  amounts: Row[];
  grandTotal: string;
  amountInWords: string;
  /** "List price … − Discount … = Basic price …" when a discount was given; otherwise null. */
  discountNote: string | null;
  supplyLabel: string;
  dealerName: string;
  preparedBy: string;
  jurisdiction: string | null;
}

const NOT_SET = '—';
const show = (v: string | null | undefined): string => (v?.trim() ? v.trim() : NOT_SET);
const percent = (bp: number): string => `${parseFloat((bp / 100).toFixed(2))}%`;

export function buildRtoInvoiceDocument(r: RtoInvoiceFigures, id: RtoInvoiceIdentity): RtoInvoiceDocument {
  const date = (d: Date): string => d.toLocaleDateString('en-IN', { timeZone: id.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
  const c = id.customer;
  const v = id.vehicle;
  const intra = r.supplyType === 'INTRA';
  const half = percent(r.gstRateBp / 2);
  const dealerState = [id.dealer.state?.trim(), id.dealer.stateCode?.trim() ? `(${id.dealer.stateCode.trim()})` : null].filter(Boolean).join(' ');

  return {
    title: 'TAX INVOICE',
    // The revision is shown in the app only; the printed invoice carries just its number.
    invoiceNumber: r.invoiceNumber,
    invoiceDate: date(r.invoiceDate),
    dealerLine: [`GSTIN: ${show(id.dealer.gstin)}`, `State: ${show(dealerState)}`, `PAN: ${show(panFromGstin(id.dealer.gstin))}`].join('     '),
    customer: [
      { label: 'Name', value: c.name },
      { label: 'Address', value: show(c.address) },
      { label: 'Village / City', value: show([c.village, c.city].map((x) => x?.trim()).filter(Boolean).join(', ')) },
      { label: 'Tehsil', value: show(c.tehsil) },
      { label: 'District', value: show(c.district) },
      { label: 'State', value: show(c.state) },
      { label: 'PIN Code', value: show(c.pin) },
      { label: 'Mobile No.', value: c.phone },
      { label: 'Aadhaar No.', value: c.aadhaarNumber ? formatAadhaar(c.aadhaarNumber) : NOT_SET },
      { label: 'PAN No.', value: show(c.panNumber) },
      { label: 'GSTIN No.', value: show(c.gstin) },
      { label: 'HPA With', value: id.financeCompany?.trim() ? id.financeCompany.trim().toUpperCase() : 'SELF' },
    ],
    references: [
      { label: 'Invoice No.', value: r.invoiceNumber },
      { label: 'Invoice Date', value: date(r.invoiceDate) },
      { label: 'Delivery Date', value: r.deliveryDate ? r.deliveryDate.split('-').reverse().join('/') : NOT_SET },
      { label: 'Policy No.', value: show(r.policyNumber) },
    ],
    vehicle: [
      { label: 'Model', value: `${v.model} ${v.variant}`.trim() },
      { label: 'Product Make', value: show(v.make) },
      { label: 'HSN Code', value: show(r.hsnCode) },
      { label: 'Fuel', value: 'Electric (Battery)' },
      { label: 'Chassis No.', value: v.vin },
      { label: 'Motor No.', value: v.motorNumber },
      { label: 'Battery No.', value: v.batteryNumber },
      { label: 'Colour', value: v.colour },
      { label: 'Key No.', value: show(v.keyNumber) },
    ],
    amounts: [
      { label: 'Basic Price', value: formatInrExact(r.sellingPrice) },
      ...(intra
        ? [
            { label: `SGST @ ${half}`, value: formatInrExact(r.sgst) },
            { label: `CGST @ ${half}`, value: formatInrExact(r.cgst) },
          ]
        : [{ label: `IGST @ ${percent(r.gstRateBp)}`, value: formatInrExact(r.igst) }]),
      { label: 'Total', value: formatInrExact(r.total) },
    ],
    grandTotal: formatInrExact(r.total),
    amountInWords: rupeesInWords(r.total),
    discountNote: r.discount > 0n ? `List price ${formatInrExact(r.listPrice)} − Discount ${formatInrExact(r.discount)} = Basic price ${formatInrExact(r.sellingPrice)}` : null,
    supplyLabel: RTO_SUPPLY_TYPE_LABEL[r.supplyType],
    dealerName: id.dealer.name,
    preparedBy: show(id.preparedBy),
    jurisdiction: id.dealer.city?.trim() ? `Subject to ${id.dealer.city.trim()} jurisdiction` : null,
  };
}
