import { planSaleTaxLines, reconcileToCommercialTotal, type SaleTaxComponents } from './sale-tax-lines';
import { SaleTaxError } from './sale-tax.errors';

const expectCode = (fn: () => unknown, code: string, lineKey?: string): void => {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(SaleTaxError);
  expect((thrown as SaleTaxError).code).toBe(code);
  if (lineKey !== undefined) expect((thrown as SaleTaxError).lineKey).toBe(lineKey);
};

// Classification ids are opaque placeholders — the planner never looks at rates, codes or treatments.
const components = (over: Partial<SaleTaxComponents> = {}): SaleTaxComponents => ({
  exShowroom: 1_000_000n, discount: 0n, exchangeValue: 0n, accessoriesTotal: 0n, rto: 0n, insuranceCharge: 0n, registration: 0n, extendedWarranty: 0n, taxAmount: 0n,
  vehicle: { sourceId: 'unit-1', description: 'Brand Model Variant (Red)', classificationId: 'cls-vehicle' },
  accessories: [],
  mappings: { EXTENDED_WARRANTY: 'cls-ew', RTO: 'cls-rto', INSURANCE: 'cls-ins', REGISTRATION: 'cls-reg' },
  discountTreatment: null, exchangeTreatment: null,
  ...over,
});
/** The booking total as the existing pricing formula computes it (taxAmount is 0). */
const commercialTotal = (c: SaleTaxComponents): bigint =>
  c.exShowroom - c.discount - c.exchangeValue + c.accessoriesTotal + c.rto + c.insuranceCharge + c.registration + c.extendedWarranty;
const grossOf = (c: SaleTaxComponents): bigint => planSaleTaxLines(c).lines.reduce((t, l) => t + l.amount, 0n);

describe('planSaleTaxLines', () => {
  it('vehicle only: one inclusive line carrying the ex-showroom amount', () => {
    const plan = planSaleTaxLines(components());
    expect(plan.lines).toEqual([
      { key: 'vehicle', componentType: 'VEHICLE', description: 'Brand Model Variant (Red)', sourceId: 'unit-1', quantity: 1, unitAmount: 1_000_000n, classificationId: 'cls-vehicle', amount: 1_000_000n },
    ]);
    expect(plan).toMatchObject({ discountTreatment: null, exchangeTreatment: null, discountAmount: 0n, exchangeAmount: 0n, afterTaxAdjustments: 0n });
  });

  it('accessories: one line per row, each with its own classification — never blended', () => {
    const plan = planSaleTaxLines(components({
      accessoriesTotal: 350_000n,
      accessories: [
        { rowId: 'ba1', accessoryId: 'acc-helmet', name: 'Helmet', qty: 2, unitPrice: 100_000n, classificationId: 'cls-a' },
        { rowId: 'ba2', accessoryId: 'acc-charger', name: 'Charger', qty: 1, unitPrice: 150_000n, classificationId: 'cls-b' },
      ],
    }));
    expect(plan.lines.map((l) => l.key)).toEqual(['vehicle', 'accessory:ba1', 'accessory:ba2']);
    expect(plan.lines[1]).toEqual({ key: 'accessory:ba1', componentType: 'ACCESSORY', description: 'Helmet', sourceId: 'acc-helmet', quantity: 2, unitAmount: 100_000n, classificationId: 'cls-a', amount: 200_000n });
    expect(plan.lines[2]).toMatchObject({ componentType: 'ACCESSORY', sourceId: 'acc-charger', quantity: 1, unitAmount: 150_000n, classificationId: 'cls-b', amount: 150_000n });
  });

  it('mapped scalar components: a line each, in a fixed order, only when the amount is positive', () => {
    const plan = planSaleTaxLines(components({ extendedWarranty: 50_000n, rto: 85_000n, insuranceCharge: 42_000n, registration: 15_000n }));
    expect(plan.lines.map((l) => [l.key, l.componentType, l.classificationId, l.amount])).toEqual([
      ['vehicle', 'VEHICLE', 'cls-vehicle', 1_000_000n],
      ['extended-warranty', 'EXTENDED_WARRANTY', 'cls-ew', 50_000n],
      ['rto', 'RTO', 'cls-rto', 85_000n],
      ['insurance', 'INSURANCE', 'cls-ins', 42_000n],
      ['registration', 'REGISTRATION', 'cls-reg', 15_000n],
    ]);
    // Zero-amount components produce no line and need no mapping at all.
    expect(planSaleTaxLines(components({ mappings: {} })).lines.map((l) => l.key)).toEqual(['vehicle']);
  });

  it('no vehicle line when ex-showroom is zero (and then no vehicle classification is needed)', () => {
    const plan = planSaleTaxLines(components({ exShowroom: 0n, rto: 10_000n, vehicle: { sourceId: 'u', description: 'x', classificationId: null } }));
    expect(plan.lines.map((l) => l.key)).toEqual(['rto']);
  });

  describe('discount / exchange follow the RECORDED policy — never an assumed one', () => {
    it('discount, REDUCES_VEHICLE_TAXABLE_VALUE: deducted from the vehicle line; nothing after tax', () => {
      const c = components({ discount: 30_000n, discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' });
      const plan = planSaleTaxLines(c);
      expect(plan.lines[0]).toMatchObject({ key: 'vehicle', unitAmount: 1_000_000n, amount: 970_000n });
      expect(plan).toMatchObject({ discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', discountAmount: 30_000n, afterTaxAdjustments: 0n });
    });

    it('discount, AFTER_TAX_ADJUSTMENT: the vehicle line is untouched; the discount only reduces the payable', () => {
      const plan = planSaleTaxLines(components({ discount: 30_000n, discountTreatment: 'AFTER_TAX_ADJUSTMENT' }));
      expect(plan.lines[0]).toMatchObject({ unitAmount: 1_000_000n, amount: 1_000_000n });
      expect(plan).toMatchObject({ discountTreatment: 'AFTER_TAX_ADJUSTMENT', discountAmount: 30_000n, afterTaxAdjustments: 30_000n });
    });

    it('exchange, both policies', () => {
      const reduces = planSaleTaxLines(components({ exchangeValue: 200_000n, exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }));
      expect(reduces.lines[0]!.amount).toBe(800_000n);
      expect(reduces).toMatchObject({ exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', exchangeAmount: 200_000n, afterTaxAdjustments: 0n });
      const after = planSaleTaxLines(components({ exchangeValue: 200_000n, exchangeTreatment: 'AFTER_TAX_ADJUSTMENT' }));
      expect(after.lines[0]!.amount).toBe(1_000_000n);
      expect(after).toMatchObject({ exchangeTreatment: 'AFTER_TAX_ADJUSTMENT', exchangeAmount: 200_000n, afterTaxAdjustments: 200_000n });
    });

    it('a discount with NO recorded policy fails closed', () => {
      expectCode(() => planSaleTaxLines(components({ discount: 1n })), 'DISCOUNT_POLICY_MISSING');
    });

    it('an exchange value with NO recorded policy fails closed', () => {
      expectCode(() => planSaleTaxLines(components({ exchangeValue: 1n })), 'EXCHANGE_POLICY_MISSING');
    });

    it('a policy is not required (and not recorded as applied) when the amount is zero', () => {
      const plan = planSaleTaxLines(components({ discountTreatment: 'AFTER_TAX_ADJUSTMENT', exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }));
      expect(plan).toMatchObject({ discountTreatment: null, exchangeTreatment: null, afterTaxAdjustments: 0n });
    });

    it('a pre-tax adjustment larger than the vehicle amount fails closed', () => {
      expectCode(() => planSaleTaxLines(components({ exShowroom: 100n, discount: 60n, exchangeValue: 60n, discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' })), 'ADJUSTMENT_EXCEEDS_VEHICLE_VALUE', 'vehicle');
    });
  });

  describe('missing configuration fails closed', () => {
    it('vehicle model without a classification', () => {
      expectCode(() => planSaleTaxLines(components({ vehicle: { sourceId: 'u', description: 'M', classificationId: null } })), 'VEHICLE_CLASSIFICATION_MISSING', 'vehicle');
    });

    it('accessory without a classification — never silently zero-rated', () => {
      expectCode(() => planSaleTaxLines(components({ accessoriesTotal: 100n, accessories: [{ rowId: 'ba1', accessoryId: 'a', name: 'Helmet', qty: 1, unitPrice: 100n, classificationId: null }] })), 'ACCESSORY_CLASSIFICATION_MISSING', 'accessory:ba1');
    });

    it.each([
      ['extendedWarranty', 'extended-warranty'], ['rto', 'rto'], ['insuranceCharge', 'insurance'], ['registration', 'registration'],
    ] as const)('%s with no component mapping', (field, key) => {
      expectCode(() => planSaleTaxLines(components({ [field]: 500n, mappings: {} })), 'COMPONENT_MAPPING_MISSING', key);
    });

    it('accessoriesTotal > 0 with no accessory rows — no line is invented', () => {
      expectCode(() => planSaleTaxLines(components({ accessoriesTotal: 5_000n })), 'ACCESSORY_TOTAL_MISMATCH');
    });

    it('accessory rows that do not add up to accessoriesTotal', () => {
      expectCode(() => planSaleTaxLines(components({ accessoriesTotal: 999n, accessories: [{ rowId: 'ba1', accessoryId: 'a', name: 'H', qty: 2, unitPrice: 100n, classificationId: 'c' }] })), 'ACCESSORY_TOTAL_MISMATCH');
    });

    it('a non-zero legacy additive taxAmount on the booking', () => {
      expectCode(() => planSaleTaxLines(components({ taxAmount: 1n })), 'LEGACY_TAX_AMOUNT_PRESENT');
    });
  });
});

describe('commercial total invariant', () => {
  const full = (over: Partial<SaleTaxComponents> = {}): SaleTaxComponents => components({
    accessoriesTotal: 350_000n,
    accessories: [
      { rowId: 'ba1', accessoryId: 'a1', name: 'Helmet', qty: 2, unitPrice: 100_000n, classificationId: 'cls-a' },
      { rowId: 'ba2', accessoryId: 'a2', name: 'Charger', qty: 1, unitPrice: 150_000n, classificationId: 'cls-b' },
    ],
    extendedWarranty: 50_000n, rto: 85_000n, insuranceCharge: 42_000n, registration: 15_000n,
    ...over,
  });

  it.each([
    ['no adjustments', {}],
    ['discount pre-tax', { discount: 30_000n, discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }],
    ['discount after tax', { discount: 30_000n, discountTreatment: 'AFTER_TAX_ADJUSTMENT' }],
    ['exchange pre-tax', { exchangeValue: 200_000n, exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }],
    ['exchange after tax', { exchangeValue: 200_000n, exchangeTreatment: 'AFTER_TAX_ADJUSTMENT' }],
    ['both, mixed policies', { discount: 30_000n, exchangeValue: 200_000n, discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', exchangeTreatment: 'AFTER_TAX_ADJUSTMENT' }],
    ['both after tax', { discount: 30_000n, exchangeValue: 200_000n, discountTreatment: 'AFTER_TAX_ADJUSTMENT', exchangeTreatment: 'AFTER_TAX_ADJUSTMENT' }],
  ] as const)('%s: line gross less after-tax adjustments equals the existing booking total', (_label, over) => {
    const c = full(over as Partial<SaleTaxComponents>);
    const plan = planSaleTaxLines(c);
    // Inclusive pricing: the engine's totalGross is exactly the sum of the planned amounts.
    expect(reconcileToCommercialTotal(grossOf(c), plan, commercialTotal(c))).toBe(commercialTotal(c));
  });

  it('refuses a result that does not reconcile to the booking total', () => {
    const c = full();
    const plan = planSaleTaxLines(c);
    expectCode(() => reconcileToCommercialTotal(grossOf(c) + 1n, plan, commercialTotal(c)), 'COMMERCIAL_TOTAL_MISMATCH');
    expectCode(() => reconcileToCommercialTotal(grossOf(c), plan, commercialTotal(c) - 1n), 'COMMERCIAL_TOTAL_MISMATCH');
  });
});
