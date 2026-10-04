import { TaxEngineError } from './tax.errors';
import { addExclusive, basisPointsToPercent, computeDocument, computeLine, extractInclusive, roundHalfUpDiv, splitTax, toBasisPoints, toPaise } from './tax-math';
import { TAX_ENGINE_VERSION, type ResolvedTaxLine, type TaxAmounts } from './tax.types';

/** Asserts `fn` throws a TaxEngineError with the given code (and line key, when given). */
const expectCode = (fn: () => unknown, code: string, lineKey?: string): void => {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(TaxEngineError);
  expect((thrown as TaxEngineError).code).toBe(code);
  if (lineKey !== undefined) expect((thrown as TaxEngineError).lineKey).toBe(lineKey);
};

// Test fixtures use placeholder codes/rates only — they are NOT real HSN/SAC values or approved rates.
const line = (over: Partial<ResolvedTaxLine> = {}): ResolvedTaxLine => ({
  key: 'l1', classificationId: 'c1', classificationName: 'Test classification', codeType: 'HSN', code: 'TEST-CODE',
  treatment: 'TAXABLE', ratePercent: '5.00', amount: 1_000_000n, pricingMode: 'INCLUSIVE', ...over,
});
const ctx = { supplyType: 'INTRA' as const, asOf: '2026-07-01' };

/** Small deterministic PRNG so property-style tests are reproducible. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const RATES = [0, 1, 25, 500, 525, 1200, 1250, 1800, 2800, 9999, 10000];

describe('toBasisPoints', () => {
  it.each([
    ['0.00', 0], ['5.00', 500], ['12.50', 1250], ['100.00', 10000],
    ['5', 500], ['5.0', 500], ['0.01', 1], ['18', 1800], ['99.99', 9999],
  ])('%s → %i', (input, expected) => {
    expect(toBasisPoints(input)).toBe(expected);
  });

  it.each(['100.01', '101', '999.99', '-1', '-0.01', '5.000', '5.123', '', ' ', 'abc', '5%', '1e2', '5,00', '.5', '5.', ' 5.00', '1000'])('rejects %p', (input) => {
    expectCode(() => toBasisPoints(input), 'INVALID_RATE');
  });

  it('rejects non-string input (never goes through a float)', () => {
    expectCode(() => toBasisPoints(5 as unknown as string), 'INVALID_RATE');
    expectCode(() => toBasisPoints(null as unknown as string), 'INVALID_RATE');
  });

  it('basisPointsToPercent gives the canonical 2-decimal form', () => {
    expect(basisPointsToPercent(500)).toBe('5.00');
    expect(basisPointsToPercent(0)).toBe('0.00');
    expect(basisPointsToPercent(1250)).toBe('12.50');
    expect(basisPointsToPercent(10000)).toBe('100.00');
    expect(basisPointsToPercent(5)).toBe('0.05');
    for (const bp of RATES) expect(toBasisPoints(basisPointsToPercent(bp))).toBe(bp);
  });
});

describe('toPaise', () => {
  it('accepts non-negative integer paise', () => {
    expect(toPaise(0n)).toBe(0n);
    expect(toPaise(0)).toBe(0n);
    expect(toPaise(1)).toBe(1n);
    expect(toPaise(1_000_000)).toBe(1_000_000n);
    expect(toPaise(10n ** 20n)).toBe(10n ** 20n);
  });

  it.each([[-1], [-1n], [1.5], [0.1], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], ['100'], [null], [undefined], [{}]])('rejects %p', (value) => {
    expectCode(() => toPaise(value), 'INVALID_AMOUNT');
  });
});

describe('roundHalfUpDiv (the single rounding helper)', () => {
  it('rounds below one half down, one half and above up', () => {
    expect(roundHalfUpDiv(149n, 100n)).toBe(1n); // 1.49 — just below .5
    expect(roundHalfUpDiv(150n, 100n)).toBe(2n); // 1.50 — exactly .5
    expect(roundHalfUpDiv(151n, 100n)).toBe(2n); // 1.51 — just above .5
    expect(roundHalfUpDiv(49n, 100n)).toBe(0n);
    expect(roundHalfUpDiv(50n, 100n)).toBe(1n);
    expect(roundHalfUpDiv(1n, 2n)).toBe(1n);
    expect(roundHalfUpDiv(1n, 3n)).toBe(0n);
    expect(roundHalfUpDiv(2n, 3n)).toBe(1n);
    expect(roundHalfUpDiv(0n, 7n)).toBe(0n);
    expect(roundHalfUpDiv(700n, 7n)).toBe(100n);
  });

  it('rejects negative numerators and non-positive denominators', () => {
    expectCode(() => roundHalfUpDiv(-1n, 2n), 'INVALID_AMOUNT');
    expectCode(() => roundHalfUpDiv(1n, 0n), 'INVALID_AMOUNT');
    expectCode(() => roundHalfUpDiv(1n, -2n), 'INVALID_AMOUNT');
  });
});

describe('extractInclusive', () => {
  it('₹10,000 at 5% → ₹9,523.81 taxable + ₹476.19 tax, gross unchanged', () => {
    expect(extractInclusive(1_000_000n, 500)).toEqual({ taxable: 952_381n, tax: 47_619n });
  });

  it('handles zero and tiny amounts', () => {
    expect(extractInclusive(0n, 500)).toEqual({ taxable: 0n, tax: 0n });
    expect(extractInclusive(1n, 500)).toEqual({ taxable: 1n, tax: 0n });
    expect(extractInclusive(2n, 500)).toEqual({ taxable: 2n, tax: 0n });
  });

  it('0% leaves the whole amount taxable', () => {
    expect(extractInclusive(1_000_000n, 0)).toEqual({ taxable: 1_000_000n, tax: 0n });
  });

  it('exact divisions produce no rounding', () => {
    expect(extractInclusive(10_500n, 500)).toEqual({ taxable: 10_000n, tax: 500n });
    expect(extractInclusive(11_800n, 1800)).toEqual({ taxable: 10_000n, tax: 1_800n });
    expect(extractInclusive(1_000_000n, 2800)).toEqual({ taxable: 781_250n, tax: 218_750n });
  });

  it('multiple rates on the same gross', () => {
    expect(extractInclusive(1_000_000n, 1200)).toEqual({ taxable: 892_857n, tax: 107_143n });
    expect(extractInclusive(1_000_000n, 1800)).toEqual({ taxable: 847_458n, tax: 152_542n });
  });

  it('large values (₹10 crore) stay exact in bigint', () => {
    const tenCrore = 10_000_000_000n; // ₹10,00,00,000 in paise
    expect(extractInclusive(tenCrore, 500)).toEqual({ taxable: 9_523_809_524n, tax: 476_190_476n });
    expect(extractInclusive(tenCrore, 1800)).toEqual({ taxable: 8_474_576_271n, tax: 1_525_423_729n });
    const huge = 10n ** 20n; // far beyond Number.MAX_SAFE_INTEGER
    const r = extractInclusive(huge, 500);
    expect(r.taxable + r.tax).toBe(huge);
  });

  it('rounds exactly-half up (100% rate halves the gross)', () => {
    expect(extractInclusive(1n, 10000)).toEqual({ taxable: 1n, tax: 0n }); // 0.5 → 1
    expect(extractInclusive(3n, 10000)).toEqual({ taxable: 2n, tax: 1n }); // 1.5 → 2
    expect(extractInclusive(4n, 10000)).toEqual({ taxable: 2n, tax: 2n }); // exact
  });

  it('PROPERTY: taxable + tax === gross, tax ≥ 0, gross never increases', () => {
    const next = lcg(20260701);
    for (const bp of RATES) {
      const grosses = [0n, 1n, 2n, 3n, 99n, 100n, 101n, 10_499n, 10_500n, 10_501n];
      for (let i = 0; i < 400; i++) grosses.push(BigInt(next() % 500_000_000));
      for (const gross of grosses) {
        const { taxable, tax } = extractInclusive(gross, bp);
        expect(taxable + tax).toBe(gross);
        expect(tax >= 0n).toBe(true);
        expect(taxable >= 0n && taxable <= gross).toBe(true);
      }
    }
  });

  it('is monotonic: a larger gross never yields a smaller taxable value', () => {
    for (const bp of [500, 1800]) {
      let previous = 0n;
      for (let g = 0n; g < 3_000n; g++) {
        const { taxable } = extractInclusive(g, bp);
        expect(taxable >= previous).toBe(true);
        previous = taxable;
      }
    }
  });

  it('rejects invalid input', () => {
    expectCode(() => extractInclusive(-1n, 500), 'INVALID_AMOUNT');
    expectCode(() => extractInclusive(100n, -1), 'INVALID_RATE');
    expectCode(() => extractInclusive(100n, 10001), 'INVALID_RATE');
    expectCode(() => extractInclusive(100n, 5.5), 'INVALID_RATE');
  });
});

describe('addExclusive', () => {
  it('adds tax on top; taxable + tax === gross', () => {
    expect(addExclusive(952_381n, 500)).toEqual({ tax: 47_619n, gross: 1_000_000n });
    expect(addExclusive(100_000n, 1800)).toEqual({ tax: 18_000n, gross: 118_000n });
    expect(addExclusive(0n, 1800)).toEqual({ tax: 0n, gross: 0n });
    expect(addExclusive(1_000_000n, 0)).toEqual({ tax: 0n, gross: 1_000_000n });
  });

  it('rounding boundaries: below .5, exactly .5, above .5 paisa', () => {
    expect(addExclusive(49n, 100)).toEqual({ tax: 0n, gross: 49n }); // 0.49
    expect(addExclusive(50n, 100)).toEqual({ tax: 1n, gross: 51n }); // 0.50
    expect(addExclusive(51n, 100)).toEqual({ tax: 1n, gross: 52n }); // 0.51
    expect(addExclusive(9n, 500)).toEqual({ tax: 0n, gross: 9n }); // 0.45
    expect(addExclusive(10n, 500)).toEqual({ tax: 1n, gross: 11n }); // 0.50
  });

  it('PROPERTY: gross === taxable + tax and tax ≥ 0', () => {
    const next = lcg(7);
    for (const bp of RATES) {
      for (let i = 0; i < 400; i++) {
        const taxable = BigInt(next() % 500_000_000);
        const { tax, gross } = addExclusive(taxable, bp);
        expect(taxable + tax).toBe(gross);
        expect(tax >= 0n).toBe(true);
      }
    }
  });

  it('inclusive then exclusive round-trips to within one paisa', () => {
    const next = lcg(99);
    for (const bp of [500, 1200, 1800, 2800]) {
      for (let i = 0; i < 300; i++) {
        const gross = BigInt(next() % 100_000_000);
        const { taxable } = extractInclusive(gross, bp);
        const diff = addExclusive(taxable, bp).gross - gross;
        expect(diff >= -1n && diff <= 1n).toBe(true);
      }
    }
  });
});

describe('splitTax — INTRA', () => {
  it('even tax splits with no round-off', () => {
    expect(splitTax(100_000n, 18_000n, 1800, 'INTRA')).toEqual({ cgst: 9_000n, sgst: 9_000n, igst: 0n, roundOff: 0n });
  });

  it('₹10,000 at 5%: symmetric heads with a −1 paisa round-off', () => {
    expect(splitTax(952_381n, 47_619n, 500, 'INTRA')).toEqual({ cgst: 23_810n, sgst: 23_810n, igst: 0n, roundOff: -1n });
  });

  it('odd tax can also leave a +1 paisa round-off', () => {
    const { tax } = addExclusive(12n, 500); // 0.6 → 1
    expect(splitTax(12n, tax, 500, 'INTRA')).toEqual({ cgst: 0n, sgst: 0n, igst: 0n, roundOff: 1n });
  });

  it('handles an odd basis-point rate (half-rate is fractional)', () => {
    const { tax } = addExclusive(1_000_000n, 525);
    expect(splitTax(1_000_000n, tax, 525, 'INTRA')).toEqual({ cgst: 26_250n, sgst: 26_250n, igst: 0n, roundOff: 0n });
  });

  it('PROPERTY: cgst === sgst and cgst + sgst + roundOff === tax; round-off is at most 1 paisa below a 100% rate', () => {
    const next = lcg(424242);
    for (const bp of RATES) {
      // Below 100% the round-off is provably within ±1 paisa. Only at exactly 100% (inclusive) can the
      // extraction's own rounding add a second paisa; reconciliation still holds there.
      const bound = bp < 10000 ? 1n : 2n;
      const grosses = [0n, 1n, 2n, 3n, 12n];
      for (let i = 0; i < 400; i++) grosses.push(BigInt(next() % 500_000_000));
      for (const gross of grosses) {
        for (const { taxable, tax } of [extractInclusive(gross, bp), { taxable: gross, tax: addExclusive(gross, bp).tax }]) {
          const s = splitTax(taxable, tax, bp, 'INTRA');
          expect(s.cgst).toBe(s.sgst);
          expect(s.igst).toBe(0n);
          expect(s.cgst + s.sgst + s.roundOff).toBe(tax);
          expect(s.roundOff >= -bound && s.roundOff <= bound).toBe(true);
        }
      }
    }
  });

  it('documents the extreme edge: 1 paisa inclusive at a 100% rate leaves a −2 paise round-off', () => {
    const { taxable, tax } = extractInclusive(1n, 10000); // taxable 1, tax 0
    expect(splitTax(taxable, tax, 10000, 'INTRA')).toEqual({ cgst: 1n, sgst: 1n, igst: 0n, roundOff: -2n });
  });
});

describe('splitTax — INTER', () => {
  it('PROPERTY: igst === tax, cgst === sgst === roundOff === 0', () => {
    const next = lcg(5150);
    for (const bp of RATES) {
      for (let i = 0; i < 200; i++) {
        const gross = BigInt(next() % 500_000_000);
        const { taxable, tax } = extractInclusive(gross, bp);
        expect(splitTax(taxable, tax, bp, 'INTER')).toEqual({ cgst: 0n, sgst: 0n, igst: tax, roundOff: 0n });
      }
    }
  });

  it('a missing / unknown supply type fails closed', () => {
    expectCode(() => splitTax(100n, 5n, 500, undefined as never), 'MISSING_SUPPLY_CONTEXT');
    expectCode(() => splitTax(100n, 5n, 500, 'EXPORT' as never), 'MISSING_SUPPLY_CONTEXT');
  });
});

describe('computeLine', () => {
  it('TAXABLE inclusive INTRA — the ₹10,000 at 5% line', () => {
    expect(computeLine(line(), 'INTRA')).toEqual({
      key: 'l1', classificationId: 'c1', classificationName: 'Test classification', codeType: 'HSN', code: 'TEST-CODE',
      treatment: 'TAXABLE', ratePercent: '5.00', pricingMode: 'INCLUSIVE',
      grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 23_810n, sgst: 23_810n, igst: 0n, roundOff: -1n,
    });
  });

  it('TAXABLE inclusive INTER', () => {
    const r = computeLine(line(), 'INTER');
    expect(r).toMatchObject({ grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 0n, sgst: 0n, igst: 47_619n, roundOff: 0n });
  });

  it('TAXABLE exclusive adds tax on top of the amount', () => {
    const r = computeLine(line({ amount: 100_000n, pricingMode: 'EXCLUSIVE', ratePercent: '18.00' }), 'INTRA');
    expect(r).toMatchObject({ grossAmount: 118_000n, taxableAmount: 100_000n, taxTotal: 18_000n, cgst: 9_000n, sgst: 9_000n, roundOff: 0n, ratePercent: '18.00' });
  });

  it('canonicalises the rate string and accepts a safe-integer number amount', () => {
    const r = computeLine(line({ ratePercent: '5', amount: 1_000_000 }), 'INTER');
    expect(r.ratePercent).toBe('5.00');
    expect(r.grossAmount).toBe(1_000_000n);
  });

  it.each(['EXEMPT', 'NIL_RATED', 'NON_TAXABLE'] as const)('%s: zero GST, treatment preserved, in both pricing modes', (treatment) => {
    for (const pricingMode of ['INCLUSIVE', 'EXCLUSIVE'] as const) {
      for (const supplyType of ['INTRA', 'INTER'] as const) {
        const r = computeLine(line({ treatment, ratePercent: null, code: null, amount: 250_000n, pricingMode }), supplyType);
        expect(r).toMatchObject({ treatment, ratePercent: null, grossAmount: 250_000n, taxableAmount: 250_000n, taxTotal: 0n, cgst: 0n, sgst: 0n, igst: 0n, roundOff: 0n });
      }
    }
  });

  it('TAXABLE at 0% stays distinguishable from NIL_RATED', () => {
    const zeroRated = computeLine(line({ ratePercent: '0.00' }), 'INTRA');
    const nilRated = computeLine(line({ treatment: 'NIL_RATED', ratePercent: null }), 'INTRA');
    expect(zeroRated.taxTotal).toBe(0n);
    expect(nilRated.taxTotal).toBe(0n);
    expect(zeroRated.treatment).toBe('TAXABLE');
    expect(zeroRated.ratePercent).toBe('0.00');
    expect(nilRated.treatment).toBe('NIL_RATED');
    expect(nilRated.ratePercent).toBeNull();
  });

  it('a zero amount is valid', () => {
    expect(computeLine(line({ amount: 0n }), 'INTRA')).toMatchObject({ grossAmount: 0n, taxableAmount: 0n, taxTotal: 0n, cgst: 0n, sgst: 0n, roundOff: 0n });
  });

  it('fails closed, attributing the failure to the line', () => {
    expectCode(() => computeLine(line({ amount: -1n }), 'INTRA'), 'INVALID_AMOUNT', 'l1');
    expectCode(() => computeLine(line({ amount: 1.5 }), 'INTRA'), 'INVALID_AMOUNT', 'l1');
    expectCode(() => computeLine(line({ amount: '100' as never }), 'INTRA'), 'INVALID_AMOUNT', 'l1');
    expectCode(() => computeLine(line({ code: null }), 'INTRA'), 'TAXABLE_WITHOUT_CODE', 'l1');
    expectCode(() => computeLine(line({ code: '  ' }), 'INTRA'), 'TAXABLE_WITHOUT_CODE', 'l1');
    expectCode(() => computeLine(line({ ratePercent: null }), 'INTRA'), 'INVALID_RATE', 'l1');
    expectCode(() => computeLine(line({ ratePercent: '101.00' }), 'INTRA'), 'INVALID_RATE', 'l1');
    expectCode(() => computeLine(line({ pricingMode: 'NET' as never }), 'INTRA'), 'INVALID_REQUEST', 'l1');
    expectCode(() => computeLine(line({ treatment: 'ZERO' as never }), 'INTRA'), 'INVALID_REQUEST', 'l1');
    expectCode(() => computeLine(line(), undefined as never), 'MISSING_SUPPLY_CONTEXT', 'l1');
  });
});

describe('computeDocument', () => {
  const mixed = (): ResolvedTaxLine[] => [
    line({ key: 'a', classificationId: 'c5', ratePercent: '5.00', amount: 1_000_000n }),
    line({ key: 'b', classificationId: 'c18', ratePercent: '18.00', amount: 118_000n }),
    line({ key: 'c', classificationId: 'c18', ratePercent: '18.00', amount: 50_000n, pricingMode: 'EXCLUSIVE' }),
    line({ key: 'd', classificationId: 'cEx', treatment: 'EXEMPT', ratePercent: null, code: null, amount: 20_000n }),
    line({ key: 'e', classificationId: 'cNon', treatment: 'NON_TAXABLE', ratePercent: null, code: null, amount: 30_000n }),
    line({ key: 'f', classificationId: 'cNil', treatment: 'NIL_RATED', ratePercent: null, code: null, amount: 0n }),
  ];
  const sumOf = (rows: TaxAmounts[], field: keyof TaxAmounts): bigint => rows.reduce((t, r) => t + r[field], 0n);

  it('INTRA: mixed rates and treatments — totals are the sums of the lines', () => {
    const doc = computeDocument(mixed(), ctx);
    expect(doc.lines.map((l) => l.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(doc.totals).toEqual({
      totalGross: 1_227_000n, totalTaxable: 1_152_381n, totalTax: 74_619n,
      totalCGST: 37_310n, totalSGST: 37_310n, totalIGST: 0n, totalRoundOff: -1n,
    });
    expect(doc.totals.totalGross).toBe(sumOf(doc.lines, 'grossAmount'));
    expect(doc.totals.totalTaxable).toBe(sumOf(doc.lines, 'taxableAmount'));
    expect(doc.totals.totalTax).toBe(sumOf(doc.lines, 'taxTotal'));
    expect(doc.totals.totalCGST).toBe(sumOf(doc.lines, 'cgst'));
    expect(doc.totals.totalSGST).toBe(sumOf(doc.lines, 'sgst'));
    expect(doc.totals.totalRoundOff).toBe(sumOf(doc.lines, 'roundOff'));
    // Reconciliation at document level.
    expect(doc.totals.totalTaxable + doc.totals.totalTax).toBe(doc.totals.totalGross);
    expect(doc.totals.totalCGST + doc.totals.totalSGST + doc.totals.totalIGST + doc.totals.totalRoundOff).toBe(doc.totals.totalTax);
    expect(doc.supplyType).toBe('INTRA');
    expect(doc.asOf).toBe('2026-07-01');
    expect(doc.engineVersion).toBe(TAX_ENGINE_VERSION);
  });

  it('INTER: all tax is IGST with no round-off', () => {
    const doc = computeDocument(mixed(), { ...ctx, supplyType: 'INTER' });
    expect(doc.totals).toEqual({
      totalGross: 1_227_000n, totalTaxable: 1_152_381n, totalTax: 74_619n,
      totalCGST: 0n, totalSGST: 0n, totalIGST: 74_619n, totalRoundOff: 0n,
    });
  });

  it('rate summary groups by treatment + rate in a deterministic order', () => {
    const doc = computeDocument(mixed(), ctx);
    expect(doc.rateSummary.map((r) => [r.treatment, r.ratePercent, r.lineCount])).toEqual([
      ['TAXABLE', '5.00', 1],
      ['TAXABLE', '18.00', 2],
      ['EXEMPT', null, 1],
      ['NIL_RATED', null, 1],
      ['NON_TAXABLE', null, 1],
    ]);
    expect(doc.rateSummary[1]).toMatchObject({ grossAmount: 177_000n, taxableAmount: 150_000n, taxTotal: 27_000n, cgst: 13_500n, sgst: 13_500n, roundOff: 0n });
    // The summary reconciles to the totals, and is independent of input order.
    expect(sumOf(doc.rateSummary, 'grossAmount')).toBe(doc.totals.totalGross);
    expect(sumOf(doc.rateSummary, 'taxTotal')).toBe(doc.totals.totalTax);
    const reversed = computeDocument(mixed().reverse(), ctx);
    expect(reversed.rateSummary).toEqual(doc.rateSummary);
    expect(reversed.totals).toEqual(doc.totals);
  });

  it('line round-offs accumulate into the document total', () => {
    const doc = computeDocument([line({ key: 'x' }), line({ key: 'y' }), line({ key: 'z' })], ctx);
    expect(doc.totals.totalRoundOff).toBe(-3n);
    expect(doc.totals.totalCGST + doc.totals.totalSGST + doc.totals.totalRoundOff).toBe(doc.totals.totalTax);
  });

  it('is all-or-nothing: one bad line fails the whole document, naming the line', () => {
    const lines = mixed();
    lines[3] = { ...lines[3]!, amount: -5n };
    expectCode(() => computeDocument(lines, ctx), 'INVALID_AMOUNT', 'd');
  });

  it('rejects structurally invalid documents', () => {
    expectCode(() => computeDocument([], ctx), 'INVALID_REQUEST');
    expectCode(() => computeDocument([line({ key: 'a' }), line({ key: 'a' })], ctx), 'INVALID_REQUEST', 'a');
    expectCode(() => computeDocument([line({ key: '' })], ctx), 'INVALID_REQUEST');
    expectCode(() => computeDocument([line()], { ...ctx, asOf: '01-07-2026' }), 'INVALID_REQUEST');
    expectCode(() => computeDocument([line()], { ...ctx, asOf: '2026-02-30' }), 'INVALID_REQUEST');
    expectCode(() => computeDocument([line()], { ...ctx, asOf: '2026-07-01T00:00:00.000Z' }), 'INVALID_REQUEST');
    expectCode(() => computeDocument([line()], { ...ctx, supplyType: undefined as never }), 'MISSING_SUPPLY_CONTEXT');
  });

  it('is deterministic: the same input gives an identical result', () => {
    expect(computeDocument(mixed(), ctx)).toEqual(computeDocument(mixed(), ctx));
  });

  it('does not mutate its input', () => {
    const lines = mixed();
    const snapshot = lines.map((l) => ({ ...l }));
    computeDocument(lines, ctx);
    expect(lines).toEqual(snapshot);
  });
});
