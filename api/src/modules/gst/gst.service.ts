import { Injectable } from '@nestjs/common';
import type {
  GstDocumentDto,
  GstHeads,
  GstInwardRowDto,
  GstIssueDto,
  GstOverviewDto,
  GstTaxHeads,
  Gstr1Dto,
  Gstr3bDto,
} from '@azad/shared';
import { GstRegisterService, type GstRegister, type InwardBill } from './gst-register.service';
import { ZERO, addHeads, buildGstr1, docHeads, sectionOf, setOff, tax3, type Gstr1, type Heads, type Tax3 } from './gst-returns';

const s = (v: bigint): string => v.toString();
const heads = (h: Heads): GstTaxHeads => ({ taxable: s(h.taxable), igst: s(h.igst), cgst: s(h.cgst), sgst: s(h.sgst) });
const three = (h: Tax3): GstHeads => ({ igst: s(h.igst), cgst: s(h.cgst), sgst: s(h.sgst) });
const SEVERITY_ORDER = { ERROR: 0, WARNING: 1, INFO: 2 } as const;

/** One month's GST: the documents, GSTR-1, GSTR-3B, the purchase (ITC) register and what to fix before filing. */
@Injectable()
export class GstService {
  constructor(private readonly register: GstRegisterService) {}

  async month(period: string): Promise<GstRegister & { period: string }> {
    const ctx = await this.register.context();
    const { from, to } = this.register.periodRange(period, ctx.timeZone);
    return { period, ...(await this.register.load(from, to)) };
  }

  async overview(period: string): Promise<GstOverviewDto> {
    const m = await this.month(period);
    const issues = this.issueList(m);
    return {
      period,
      gstr1: { documents: m.docs.filter((d) => d.kind !== 'CANCELLATION').length, totals: heads(buildGstr1(m.docs, { sixDigitHsn: m.ctx.sixDigitHsn }).totals) },
      gstr3b: this.toGstr3b(m),
      issues: { errors: issues.filter((i) => i.severity === 'ERROR').length, warnings: issues.filter((i) => i.severity === 'WARNING').length, info: issues.filter((i) => i.severity === 'INFO').length },
    };
  }

  async documents(period: string): Promise<GstDocumentDto[]> {
    const m = await this.month(period);
    return m.docs.map((d) => ({
      ...heads(docHeads(d)), id: d.id, kind: d.kind, series: d.series, number: d.number, date: d.date, buyerName: d.buyerName, buyerGstin: d.buyerGstin,
      placeOfSupply: d.placeOfSupply, supplyType: d.supplyType, section: sectionOf(d), value: s(d.value), cancelled: d.cancelled, original: d.original, link: d.link,
      lines: d.lines.map((l) => ({ ...heads(l), code: l.code, codeType: l.codeType, description: l.description, uqc: l.uqc, quantity: l.quantity, ratePercent: l.ratePercent, treatment: l.treatment })),
    }));
  }

  async gstr1(period: string): Promise<Gstr1Dto> {
    const m = await this.month(period);
    return this.toGstr1Dto(period, buildGstr1(m.docs, { sixDigitHsn: m.ctx.sixDigitHsn }));
  }

  async gstr3b(period: string): Promise<Gstr3bDto> {
    return this.toGstr3b(await this.month(period));
  }

  async inward(period: string): Promise<GstInwardRowDto[]> {
    const m = await this.month(period);
    return m.inward.map((b) => ({ ...heads(b), id: b.id, source: b.source, reference: b.reference, billNumber: b.billNumber, billDate: b.billDate, vendorName: b.vendorName, vendorGstin: b.vendorGstin, supplyType: b.supplyType, itc: b.itc, paid: b.paid }));
  }

  async issues(period: string): Promise<GstIssueDto[]> {
    return this.issueList(await this.month(period));
  }

  /** Output tax and eligible input credit per month of a range — the Finance GST summary. */
  async monthlyTotals(from: Date, to: Date): Promise<{ month: string; output: bigint; input: bigint }[]> {
    const r = await this.register.load(from, to);
    const out = new Map<string, { output: bigint; input: bigint }>();
    const at = (month: string) => out.get(month) ?? { output: 0n, input: 0n };
    for (const d of r.docs) {
      const section = sectionOf(d);
      if (section === null) continue;
      const tax = docHeads(d);
      const sign = d.kind === 'INVOICE' ? 1n : -1n;
      const m = at(d.date.slice(0, 7));
      out.set(d.date.slice(0, 7), { ...m, output: m.output + sign * (tax.igst + tax.cgst + tax.sgst) });
    }
    for (const b of r.inward) {
      if (b.itc !== 'ELIGIBLE') continue;
      const m = at(b.billDate.slice(0, 7));
      out.set(b.billDate.slice(0, 7), { ...m, input: m.input + b.igst + b.cgst + b.sgst });
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  }

  // ── internals ──
  private issueList(m: GstRegister): GstIssueDto[] {
    const issues = [...m.issues];
    if (!m.ctx.gstEnabled) issues.unshift({ code: 'GST_DISABLED', severity: 'INFO', message: 'GST is turned off in GST Management — new invoices carry no GST.', reference: null, link: null });
    // Gaps in a series within the month (numbers are consecutive per series, Rule 46(b)).
    const bySeries = new Map<string, string[]>();
    for (const d of m.docs) if (d.kind !== 'CANCELLATION') bySeries.set(d.series, [...(bySeries.get(d.series) ?? []), d.number]);
    for (const [series, numbers] of bySeries) {
      const parsed = numbers.map((n) => { const x = /^(.*?)(\d+)$/.exec(n); return x ? { prefix: x[1]!, n: Number(x[2]) } : null; }).filter(Boolean) as { prefix: string; n: number }[];
      const byPrefix = new Map<string, number[]>();
      for (const p of parsed) byPrefix.set(p.prefix, [...(byPrefix.get(p.prefix) ?? []), p.n]);
      for (const [prefix, list] of byPrefix) {
        const sorted = [...new Set(list)].sort((a, b) => a - b);
        const missing = sorted[sorted.length - 1]! - sorted[0]! + 1 - sorted.length;
        if (missing > 0) issues.push({ code: 'SERIES_GAP', severity: 'WARNING', message: `${missing} number${missing === 1 ? '' : 's'} missing in ${prefix}${sorted[0]}–${prefix}${sorted[sorted.length - 1]} (${series.toLowerCase().replace('_', ' ')}) — explain or cancel them in Table 13.`, reference: null, link: null });
      }
    }
    return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  private toGstr3b(m: GstRegister & { period: string }): Gstr3bDto {
    let outward = ZERO;
    let nilExempt = 0n;
    const inter = new Map<string, { taxable: bigint; igst: bigint }>();
    for (const d of m.docs) {
      const section = sectionOf(d);
      if (section === null) continue;
      const sign: 1n | -1n = d.kind === 'INVOICE' ? 1n : -1n;
      const h = docHeads(d);
      outward = addHeads(outward, h, sign);
      for (const l of d.lines) if (l.treatment !== 'TAXABLE') nilExempt += sign * l.taxable;
      if (d.supplyType === 'INTER' && !d.buyerGstin && d.placeOfSupply) {
        const prev = inter.get(d.placeOfSupply) ?? { taxable: 0n, igst: 0n };
        inter.set(d.placeOfSupply, { taxable: prev.taxable + sign * h.taxable, igst: prev.igst + sign * h.igst });
      }
    }
    outward = addHeads(outward, m.otherIncome);
    const sum = (rows: InwardBill[]): Tax3 => rows.reduce<Tax3>((t, b) => ({ igst: t.igst + b.igst, cgst: t.cgst + b.cgst, sgst: t.sgst + b.sgst }), { igst: 0n, cgst: 0n, sgst: 0n });
    const claimable = m.inward.filter((b) => b.itc !== 'NO_GSTIN');
    const available = sum(claimable);
    const reversed = sum(m.inward.filter((b) => b.itc === 'BLOCKED'));
    const net = { igst: available.igst - reversed.igst, cgst: available.cgst - reversed.cgst, sgst: available.sgst - reversed.sgst };
    const liability = tax3(outward);
    const payment = setOff(liability, net);
    return {
      period: m.period,
      outwardTaxable: heads(outward),
      outwardNilExempt: s(nilExempt),
      interStateUnregistered: [...inter.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([placeOfSupply, v]) => ({ placeOfSupply, taxable: s(v.taxable), igst: s(v.igst) })),
      otherIncome: heads(m.otherIncome),
      itc: { available: three(available), reversed: three(reversed), net: three(net), notClaimable: three(sum(m.inward.filter((b) => b.itc === 'NO_GSTIN'))) },
      payment: { liability: three(liability), itcUsed: three(payment.itcUsed), cash: three(payment.cash) },
    };
  }

  private toGstr1Dto(period: string, g: Gstr1): Gstr1Dto {
    const inv = (r: Gstr1['b2b'][number]) => ({ ...heads(r), number: r.number, date: r.date, buyerGstin: r.buyerGstin, buyerName: r.buyerName, value: s(r.value), placeOfSupply: r.placeOfSupply, ratePercent: r.ratePercent });
    const hsn = (r: Gstr1['hsnB2b'][number]) => ({ ...heads(r), code: r.code, description: r.description, uqc: r.uqc, quantity: r.quantity, ratePercent: r.ratePercent, totalValue: s(r.totalValue) });
    return {
      period,
      b2b: g.b2b.map(inv),
      b2cl: g.b2cl.map(inv),
      b2cs: g.b2cs.map((r) => ({ ...heads(r), placeOfSupply: r.placeOfSupply, ratePercent: r.ratePercent })),
      cdnr: g.cdnr.map((r) => ({ ...inv(r), noteType: r.noteType, original: r.original })),
      cdnur: g.cdnur.map((r) => ({ ...inv(r), noteType: r.noteType, original: r.original })),
      hsnB2b: g.hsnB2b.map(hsn),
      hsnB2c: g.hsnB2c.map(hsn),
      documents: g.documents,
      nilExempt: g.nilExempt.map((r) => ({ description: r.description, nil: s(r.nil), exempt: s(r.exempt), nonGst: s(r.nonGst) })),
      totals: heads(g.totals),
    };
  }
}
