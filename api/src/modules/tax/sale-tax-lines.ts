import { GstAdjustmentTreatment, TaxLineComponent, TaxMappedComponent } from '@prisma/client';
import { SaleTaxError, SaleTaxErrorCode } from './sale-tax.errors';

/**
 * Turns a booking's existing commercial components into tax-calculable lines. Pure — no database,
 * no Nest, no rates and no treatment decisions: it only decides WHICH lines exist, WHAT amount each
 * carries and WHICH classification id it points at. Every amount is the booking's own figure
 * (GST-inclusive), so nothing here can change the customer's total.
 *
 * Fail closed: a component that carries money but has no classification, a discount / exchange with
 * no recorded policy, or figures that do not add up all throw — nothing is defaulted.
 */

export interface SaleTaxComponents {
  exShowroom: bigint;
  discount: bigint;
  exchangeValue: bigint;
  accessoriesTotal: bigint;
  rto: bigint;
  insuranceCharge: bigint;
  registration: bigint;
  extendedWarranty: bigint;
  /** The booking's legacy ADDITIVE tax field. Must be zero for GST-inclusive extraction. */
  taxAmount: bigint;
  vehicle: { sourceId: string; description: string; classificationId: string | null };
  accessories: { rowId: string; accessoryId: string; name: string; qty: number; unitPrice: bigint; classificationId: string | null }[];
  /** Classification id per mapped component, for this company. */
  mappings: Partial<Record<TaxMappedComponent, string>>;
  /** The company's recorded policies (null = not decided). */
  discountTreatment: GstAdjustmentTreatment | null;
  exchangeTreatment: GstAdjustmentTreatment | null;
}

export interface PlannedSaleTaxLine {
  key: string;
  componentType: TaxLineComponent;
  description: string;
  sourceId: string | null;
  quantity: number;
  /** The commercial amount per unit before any pre-tax adjustment. */
  unitAmount: bigint;
  classificationId: string;
  /** GST-inclusive amount handed to the engine. */
  amount: bigint;
}

export interface SaleTaxPlan {
  lines: PlannedSaleTaxLine[];
  /** The policy actually applied — null when the booking carries no such amount. */
  discountTreatment: GstAdjustmentTreatment | null;
  exchangeTreatment: GstAdjustmentTreatment | null;
  discountAmount: bigint;
  exchangeAmount: bigint;
  /** Adjustments that reduce only the amount payable (not any taxable value). */
  afterTaxAdjustments: bigint;
}

const MAPPED: readonly { component: TaxMappedComponent; lineComponent: TaxLineComponent; key: string; label: string; amount: (c: SaleTaxComponents) => bigint }[] = [
  { component: TaxMappedComponent.EXTENDED_WARRANTY, lineComponent: TaxLineComponent.EXTENDED_WARRANTY, key: 'extended-warranty', label: 'Extended warranty', amount: (c) => c.extendedWarranty },
  { component: TaxMappedComponent.RTO, lineComponent: TaxLineComponent.RTO, key: 'rto', label: 'RTO', amount: (c) => c.rto },
  { component: TaxMappedComponent.INSURANCE, lineComponent: TaxLineComponent.INSURANCE, key: 'insurance', label: 'Insurance', amount: (c) => c.insuranceCharge },
  { component: TaxMappedComponent.REGISTRATION, lineComponent: TaxLineComponent.REGISTRATION, key: 'registration', label: 'Registration', amount: (c) => c.registration },
];

export function planSaleTaxLines(c: SaleTaxComponents): SaleTaxPlan {
  if (c.taxAmount !== 0n) {
    throw new SaleTaxError(SaleTaxErrorCode.LEGACY_TAX_AMOUNT_PRESENT, 'the booking carries a legacy additive tax amount, which GST-inclusive pricing cannot absorb');
  }

  // ── Adjustments: the treatment is a recorded CA decision, never assumed ──
  let discountTreatment: GstAdjustmentTreatment | null = null;
  let exchangeTreatment: GstAdjustmentTreatment | null = null;
  if (c.discount > 0n) {
    if (c.discountTreatment === null) throw new SaleTaxError(SaleTaxErrorCode.DISCOUNT_POLICY_MISSING, 'the booking has a discount but the GST treatment of discounts has not been recorded for this company');
    discountTreatment = c.discountTreatment;
  }
  if (c.exchangeValue > 0n) {
    if (c.exchangeTreatment === null) throw new SaleTaxError(SaleTaxErrorCode.EXCHANGE_POLICY_MISSING, 'the booking has an exchange value but the GST treatment of exchange has not been recorded for this company');
    exchangeTreatment = c.exchangeTreatment;
  }
  let preTax = 0n;
  let afterTax = 0n;
  if (discountTreatment === GstAdjustmentTreatment.REDUCES_VEHICLE_TAXABLE_VALUE) preTax += c.discount;
  else if (discountTreatment === GstAdjustmentTreatment.AFTER_TAX_ADJUSTMENT) afterTax += c.discount;
  if (exchangeTreatment === GstAdjustmentTreatment.REDUCES_VEHICLE_TAXABLE_VALUE) preTax += c.exchangeValue;
  else if (exchangeTreatment === GstAdjustmentTreatment.AFTER_TAX_ADJUSTMENT) afterTax += c.exchangeValue;

  const lines: PlannedSaleTaxLine[] = [];

  // ── Vehicle: one line from the ex-showroom amount ──
  if (preTax > c.exShowroom) {
    throw new SaleTaxError(SaleTaxErrorCode.ADJUSTMENT_EXCEEDS_VEHICLE_VALUE, 'the discount / exchange to be deducted before tax is larger than the ex-showroom amount', 'vehicle');
  }
  if (c.exShowroom > 0n) {
    if (!c.vehicle.classificationId) {
      throw new SaleTaxError(SaleTaxErrorCode.VEHICLE_CLASSIFICATION_MISSING, `the vehicle model "${c.vehicle.description}" has no tax classification`, 'vehicle');
    }
    lines.push({
      key: 'vehicle',
      componentType: TaxLineComponent.VEHICLE,
      description: c.vehicle.description,
      sourceId: c.vehicle.sourceId,
      quantity: 1,
      unitAmount: c.exShowroom,
      classificationId: c.vehicle.classificationId,
      amount: c.exShowroom - preTax,
    });
  }

  // ── Accessories: one line per booking accessory row — never blended ──
  const accessoriesSum = c.accessories.reduce((t, a) => t + a.unitPrice * BigInt(a.qty), 0n);
  if (accessoriesSum !== c.accessoriesTotal) {
    throw new SaleTaxError(SaleTaxErrorCode.ACCESSORY_TOTAL_MISMATCH, 'the booking accessories total does not match its accessory rows');
  }
  for (const a of c.accessories) {
    const key = `accessory:${a.rowId}`;
    if (!a.classificationId) throw new SaleTaxError(SaleTaxErrorCode.ACCESSORY_CLASSIFICATION_MISSING, `the accessory "${a.name}" has no tax classification`, key);
    lines.push({
      key,
      componentType: TaxLineComponent.ACCESSORY,
      description: a.name,
      sourceId: a.accessoryId,
      quantity: a.qty,
      unitAmount: a.unitPrice,
      classificationId: a.classificationId,
      amount: a.unitPrice * BigInt(a.qty),
    });
  }

  // ── Scalar components classified by company mapping (treatment comes from the classification) ──
  for (const m of MAPPED) {
    const amount = m.amount(c);
    if (amount <= 0n) continue;
    const classificationId = c.mappings[m.component];
    if (!classificationId) throw new SaleTaxError(SaleTaxErrorCode.COMPONENT_MAPPING_MISSING, `no tax classification is mapped for ${m.label}`, m.key);
    lines.push({ key: m.key, componentType: m.lineComponent, description: m.label, sourceId: null, quantity: 1, unitAmount: amount, classificationId, amount });
  }

  return { lines, discountTreatment, exchangeTreatment, discountAmount: c.discount, exchangeAmount: c.exchangeValue, afterTaxAdjustments: afterTax };
}

/**
 * The hard invariant: the calculated lines, less the adjustments that only reduce the amount payable,
 * must equal the booking's existing commercial total exactly. Returns that total.
 */
export function reconcileToCommercialTotal(totalGross: bigint, plan: SaleTaxPlan, commercialTotal: bigint): bigint {
  const documentTotal = totalGross - plan.afterTaxAdjustments;
  if (documentTotal !== commercialTotal) {
    throw new SaleTaxError(SaleTaxErrorCode.COMMERCIAL_TOTAL_MISMATCH, 'the calculated GST lines do not reconcile to the booking total');
  }
  return documentTotal;
}
