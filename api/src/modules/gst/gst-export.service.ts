import { Injectable } from '@nestjs/common';
import { GST_SERIES_LABEL, gstPlaceOfSupply, type GstTaxHeads } from '@azad/shared';
import { ExportService, type WorkbookSheet } from '../../export/export.service';
import { GstService } from './gst.service';

export interface GstFile { buffer: Buffer; filename: string }

/** Paise (string) → rupees, two decimals, as a number Excel can sum. */
const rs = (paise: string | bigint | number): number => Number(paise) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-05' → '05-Oct-2026', the date format of the GST Offline Tool's Excel template. */
const offlineDate = (d: string): string => `${d.slice(8, 10)}-${MONTHS[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
const uqc = (u: string): string => (u === 'NOS' ? 'NOS-NUMBERS' : u);
const tax = (h: GstTaxHeads): number => rs(BigInt(h.igst) + BigInt(h.cgst) + BigInt(h.sgst));

/**
 * The month's GST as Excel files: GSTR-1 in the GST Offline Tool's sheet layout (three summary rows, the
 * template's column headers on row 4, data from row 5), a GSTR-3B summary, and the sales and purchase registers
 * the CA reconciles against. Built from the same figures the GST screens show.
 */
@Injectable()
export class GstExportService {
  constructor(
    private readonly gst: GstService,
    private readonly exporter: ExportService,
  ) {}

  async gstr1(period: string): Promise<GstFile> {
    const g = await this.gst.gstr1(period);
    const count = <T>(rows: T[], key: (r: T) => string): number => new Set(rows.map(key)).size;
    const sum = (rows: { taxable: string }[]): number => rows.reduce((t, r) => t + rs(r.taxable), 0);
    const values = (rows: { number: string; value: string }[]): number => [...new Map(rows.map((r) => [r.number, rs(r.value)])).values()].reduce((a, b) => a + b, 0);
    const summary = (title: string, labels: string[], vals: (string | number)[]): (string | number)[][] => [[title], labels, vals];
    const sheets: WorkbookSheet[] = [
      {
        name: 'b2b',
        preamble: summary('Summary For B2B(4)', ['No. of Recipients', '', 'No. of Invoices', '', 'Total Invoice Value', '', '', '', '', '', '', 'Total Taxable Value', 'Total Cess'],
          [count(g.b2b, (r) => r.buyerGstin ?? ''), '', count(g.b2b, (r) => r.number), '', values(g.b2b), '', '', '', '', '', '', sum(g.b2b), 0]),
        columns: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'].map((header) => ({ header, width: 20 })),
        rows: g.b2b.map((r) => [r.buyerGstin, r.buyerName, r.number, offlineDate(r.date), rs(r.value), r.placeOfSupply, 'N', null, 'Regular B2B', null, r.ratePercent, rs(r.taxable), 0]),
        moneyColumns: [4, 11, 12],
      },
      {
        name: 'b2cl',
        preamble: summary('Summary For B2CL(5)', ['No. of Invoices', '', 'Total Inv Value', '', '', 'Total Taxable Value', 'Total Cess'], [count(g.b2cl, (r) => r.number), '', values(g.b2cl), '', '', sum(g.b2cl), 0]),
        columns: ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'].map((header) => ({ header, width: 20 })),
        rows: g.b2cl.map((r) => [r.number, offlineDate(r.date), rs(r.value), r.placeOfSupply, null, r.ratePercent, rs(r.taxable), 0, null]),
        moneyColumns: [2, 6, 7],
      },
      {
        name: 'b2cs',
        preamble: summary('Summary For B2CS(7)', ['', '', '', '', 'Total Taxable  Value', 'Total Cess'], ['', '', '', '', sum(g.b2cs), 0]),
        columns: ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'].map((header) => ({ header, width: 20 })),
        rows: g.b2cs.map((r) => ['OE', r.placeOfSupply, null, r.ratePercent, rs(r.taxable), 0, null]),
        moneyColumns: [4, 5],
      },
      {
        name: 'cdnr',
        preamble: summary('Summary For CDNR(9B)', ['No. of Recipients', '', 'No. of Notes', '', '', '', '', '', 'Total Note Value', '', '', 'Total Taxable Value', 'Total Cess'],
          [count(g.cdnr, (r) => r.buyerGstin ?? ''), '', count(g.cdnr, (r) => r.number), '', '', '', '', '', values(g.cdnr), '', '', sum(g.cdnr), 0]),
        columns: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'].map((header) => ({ header, width: 20 })),
        rows: g.cdnr.map((r) => [r.buyerGstin, r.buyerName, r.number, offlineDate(r.date), r.noteType, r.placeOfSupply, 'N', 'Regular B2B', rs(r.value), null, r.ratePercent, rs(r.taxable), 0]),
        moneyColumns: [8, 11, 12],
      },
      {
        name: 'cdnur',
        preamble: summary('Summary For CDNUR(9B)', ['', 'No. of Notes/Vouchers', '', '', '', 'Total Note Value', '', '', 'Total Taxable Value', 'Total Cess'], ['', count(g.cdnur, (r) => r.number), '', '', '', values(g.cdnur), '', '', sum(g.cdnur), 0]),
        columns: ['UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'].map((header) => ({ header, width: 20 })),
        rows: g.cdnur.map((r) => ['B2CL', r.number, offlineDate(r.date), r.noteType, r.placeOfSupply, rs(r.value), null, r.ratePercent, rs(r.taxable), 0]),
        moneyColumns: [5, 8, 9],
      },
      {
        name: 'exemp',
        preamble: summary('Summary For Nil rated, exempted and non GST outward supplies (8)', ['', 'Total Nil Rated Supplies', 'Total Exempted Supplies', 'Total Non-GST Supplies'],
          ['', g.nilExempt.reduce((t, r) => t + rs(r.nil), 0), g.nilExempt.reduce((t, r) => t + rs(r.exempt), 0), g.nilExempt.reduce((t, r) => t + rs(r.nonGst), 0)]),
        columns: ['Description', 'Nil Rated Supplies', 'Exempted(other than nil rated/non GST supply)', 'Non-GST Supplies'].map((header) => ({ header, width: 36 })),
        rows: ['Inter-State supplies to registered persons', 'Intra-State supplies to registered persons', 'Inter-State supplies to unregistered persons', 'Intra-State supplies to unregistered persons'].map((d) => {
          const r = g.nilExempt.find((x) => x.description === d);
          return [d, rs(r?.nil ?? '0'), rs(r?.exempt ?? '0'), rs(r?.nonGst ?? '0')];
        }),
        moneyColumns: [1, 2, 3],
      },
      ...(['b2b', 'b2c'] as const).map((side): WorkbookSheet => {
        const rows = side === 'b2b' ? g.hsnB2b : g.hsnB2c;
        return {
          name: `hsn(${side})`,
          preamble: summary('Summary For HSN(12)', ['No. of HSN', '', '', '', 'Total Value', '', 'Total Taxable Value', 'Total Integrated Tax', 'Total Central Tax', 'Total State/UT Tax', 'Total Cess'],
            [rows.length, '', '', '', rows.reduce((t, r) => t + rs(r.totalValue), 0), '', rows.reduce((t, r) => t + rs(r.taxable), 0), rows.reduce((t, r) => t + rs(r.igst), 0), rows.reduce((t, r) => t + rs(r.cgst), 0), rows.reduce((t, r) => t + rs(r.sgst), 0), 0]),
          columns: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'].map((header) => ({ header, width: 18 })),
          rows: rows.map((r) => [r.code, r.description, uqc(r.uqc), r.quantity, rs(r.totalValue), r.ratePercent, rs(r.taxable), rs(r.igst), rs(r.cgst), rs(r.sgst), 0]),
          moneyColumns: [4, 6, 7, 8, 9, 10],
        };
      }),
      {
        name: 'docs',
        preamble: summary('Summary of documents issued during the tax period (13)', ['', '', '', 'Total Number', 'Total Cancelled'],
          ['', '', '', g.documents.reduce((t, d) => t + d.total, 0), g.documents.reduce((t, d) => t + d.cancelled, 0)]),
        columns: ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'].map((header) => ({ header, width: 28 })),
        rows: g.documents.map((d) => [d.nature, d.from, d.to, d.total, d.cancelled]),
      },
    ];
    return { buffer: await this.exporter.toWorkbook(sheets), filename: `GSTR1-${period}.xlsx` };
  }

  async gstr3b(period: string): Promise<GstFile> {
    const r = await this.gst.gstr3b(period);
    const row = (section: string, description: string, h: { taxable?: string; igst: string; cgst: string; sgst: string }): (string | number | null)[] =>
      [section, description, h.taxable === undefined ? null : rs(h.taxable), rs(h.igst), rs(h.cgst), rs(h.sgst), 0];
    const zero = { igst: '0', cgst: '0', sgst: '0' };
    const sheets: WorkbookSheet[] = [
      {
        name: 'GSTR-3B',
        preamble: [[`GSTR-3B for ${period} — prepared from the app; check against GSTR-2B before filing`]],
        columns: ['Table', 'Description', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'].map((header, i) => ({ header, width: i === 1 ? 60 : 16 })),
        rows: [
          row('3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated and exempted)', r.outwardTaxable),
          row('3.1(b)', 'Outward taxable supplies (zero rated)', { taxable: '0', ...zero }),
          row('3.1(c)', 'Other outward supplies (nil rated, exempted)', { taxable: r.outwardNilExempt, ...zero }),
          row('3.1(d)', 'Inward supplies (liable to reverse charge)', { taxable: '0', ...zero }),
          row('3.1(e)', 'Non-GST outward supplies', { taxable: '0', ...zero }),
          ...r.interStateUnregistered.map((x) => ['3.2', `Inter-State supplies to unregistered persons — ${gstPlaceOfSupply(x.placeOfSupply)}`, rs(x.taxable), rs(x.igst), null, null, null]),
          row('4(A)(5)', 'ITC available — all other ITC', r.itc.available),
          row('4(B)(1)', 'ITC reversed — as per rules 38, 42 & 43 and section 17(5)', r.itc.reversed),
          row('4(C)', 'Net ITC available (A) − (B)', r.itc.net),
          row('—', 'GST on bills without the supplier’s GSTIN (not claimable; not in 4)', r.itc.notClaimable),
          row('6.1', 'Tax payable', r.payment.liability),
          row('6.1', 'Paid through ITC (credit used, by its head)', r.payment.itcUsed),
          row('6.1', 'Paid in cash', r.payment.cash),
        ],
        moneyColumns: [2, 3, 4, 5, 6],
      },
    ];
    return { buffer: await this.exporter.toWorkbook(sheets), filename: `GSTR3B-${period}.xlsx` };
  }

  async salesRegister(period: string): Promise<GstFile> {
    const docs = await this.gst.documents(period);
    const KIND = { INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', CANCELLATION: 'Cancellation (earlier invoice)' } as const;
    const rows: (string | number | null)[][] = [];
    for (const d of docs) {
      const base = [d.date, d.number, KIND[d.kind], GST_SERIES_LABEL[d.series], d.cancelled ? 'Cancelled' : d.section ?? '', d.buyerName, d.buyerGstin, gstPlaceOfSupply(d.placeOfSupply), d.original?.number ?? null];
      if (d.lines.length === 0) rows.push([...base, null, 'No GST breakdown', null, null, 0, 0, 0, 0, rs(d.value)]);
      for (const l of d.lines) rows.push([...base, l.code, l.description, l.quantity, l.ratePercent, rs(l.taxable), rs(l.igst), rs(l.cgst), rs(l.sgst), rs(d.value)]);
    }
    const sheets: WorkbookSheet[] = [{
      name: 'Sales register',
      columns: ['Date', 'Number', 'Document', 'Series', 'GSTR-1 section', 'Buyer', 'Buyer GSTIN', 'Place of supply', 'Against invoice', 'HSN / SAC', 'Description', 'Qty', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Document value'].map((header) => ({ header, width: 16 })),
      rows,
      moneyColumns: [13, 14, 15, 16, 17],
    }];
    return { buffer: await this.exporter.toWorkbook(sheets), filename: `GST-sales-register-${period}.xlsx` };
  }

  async purchaseRegister(period: string): Promise<GstFile> {
    const bills = await this.gst.inward(period);
    const SOURCE = { SCOOTER: 'Scooter purchase', ACCESSORY_PURCHASE: 'Accessory purchase', EXPENSE: 'Expense' } as const;
    const ITC = { ELIGIBLE: 'Eligible', BLOCKED: 'Blocked — s.17(5)', NO_GSTIN: 'Not claimable — supplier GSTIN missing' } as const;
    const sheets: WorkbookSheet[] = [{
      name: 'Purchase register',
      columns: ['Bill date', 'Bill number', 'Supplier', 'Supplier GSTIN', 'Our reference', 'Type', 'Supply', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total GST', 'Input credit', 'Paid'].map((header) => ({ header, width: 18 })),
      rows: bills.map((b) => [b.billDate, b.billNumber, b.vendorName, b.vendorGstin, b.reference, SOURCE[b.source], b.supplyType === 'INTER' ? 'Inter-state' : 'Intra-state', rs(b.taxable), rs(b.igst), rs(b.cgst), rs(b.sgst), tax(b), ITC[b.itc], b.paid ? 'Yes' : 'No']),
      moneyColumns: [7, 8, 9, 10, 11],
    }];
    return { buffer: await this.exporter.toWorkbook(sheets), filename: `GST-purchase-register-${period}.xlsx` };
  }
}
