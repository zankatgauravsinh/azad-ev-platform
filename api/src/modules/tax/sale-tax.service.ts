import { Injectable } from '@nestjs/common';
import { Prisma, TaxMappedComponent, type GstAdjustmentTreatment, type TaxLineComponent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { planSaleTaxLines, reconcileToCommercialTotal, type PlannedSaleTaxLine, type SaleTaxComponents } from './sale-tax-lines';
import { SaleTaxError, SaleTaxErrorCode, toSaleTaxException } from './sale-tax.errors';
import type { CalendarDate } from './tax-calendar';
import { TaxEngineService } from './tax-engine.service';
import { resolveSaleTaxPoint } from './tax-point';
import { resolveSupplyContext } from './tax-supply';
import { PricingMode, type SupplyType, type TaxDocumentResult, type TaxLineResult } from './tax.types';

type Tx = Prisma.TransactionClient;

/** The booking fields the GST calculation reads. The booking service's loaded booking satisfies this. */
export interface SaleTaxBookingInput {
  id: string;
  companyId: string;
  customerId: string;
  unitId: string;
  exShowroom: bigint;
  discount: bigint;
  exchangeValue: bigint;
  accessoriesTotal: bigint;
  rto: bigint;
  insuranceCharge: bigint;
  registration: bigint;
  extendedWarranty: bigint;
  taxAmount: bigint;
  total: bigint;
  unit: { variant: { name: string; colour: string; model: { name: string; brand: string; taxClassificationId: string | null } } };
}

/** A fully calculated, reconciled GST result waiting to be written with its Sale. */
export interface PreparedSaleTax {
  companyId: string;
  asOf: CalendarDate;
  supplyType: SupplyType;
  supplierGstin: string;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  discountTreatment: GstAdjustmentTreatment | null;
  exchangeTreatment: GstAdjustmentTreatment | null;
  discountAmount: bigint;
  exchangeAmount: bigint;
  /** Always equal to the booking / sale total. */
  documentTotal: bigint;
  result: TaxDocumentResult;
  lines: { plan: PlannedSaleTaxLine; result: TaxLineResult }[];
}

/**
 * Connects Booking → Sale to the tax engine (Stage C).
 *
 *  prepare()  — read-only. Returns null when GST is disabled for the company (the caller then creates
 *               the Sale exactly as before). Otherwise resolves classifications, supply context and the
 *               tax point, runs the engine and reconciles to the booking total — or throws (HTTP 422,
 *               fail closed) BEFORE any transaction starts, so no Sale and no invoice number result.
 *  persist()  — writes the immutable TaxSnapshot + lines inside the caller's Sale transaction.
 *
 * The commercial model is untouched: Booking.total, Sale.total and both legacy taxAmount fields are
 * neither read as tax nor written. GST is EXTRACTED from the booking's GST-inclusive amounts.
 *
 * RETURNS BOUNDARY: Sale.taxAmount stays 0 for GST sales, so the existing return / CreditNote flow is
 * unchanged and still records gstAmount = 0. A GST-correct reversal must be built from the TaxSnapshot
 * (later stage) before GST is enabled for any company that processes returns.
 */
@Injectable()
export class SaleTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TaxEngineService,
  ) {}

  async prepare(booking: SaleTaxBookingInput, events: { invoicedAt: Date }): Promise<PreparedSaleTax | null> {
    const companyId = booking.companyId;
    const setting = await this.prisma.companySetting.findFirst({
      where: { companyId },
      select: { gstEnabled: true, gstNumber: true, gstStateCode: true, timezone: true, gstDiscountTreatment: true, gstExchangeTreatment: true },
    });
    // GST off (the default, and every company today): no engine, no snapshot, no requirements.
    if (!setting?.gstEnabled) return null;

    try {
      const supplierGstin = setting.gstNumber?.trim() ?? '';
      if (supplierGstin === '') throw new SaleTaxError(SaleTaxErrorCode.SUPPLIER_GSTIN_MISSING, 'the company GSTIN is not set');

      const customer = await this.prisma.customer.findFirst({ where: { id: booking.customerId, companyId }, select: { gstStateCode: true } });
      const supply = resolveSupplyContext(setting.gstStateCode, customer?.gstStateCode);
      const asOf = resolveSaleTaxPoint(events, setting.timezone);

      // Deterministic line order: rows added together share a createdAt, so tie-break by accessory name, then id.
      const accessoryRows = await this.prisma.bookingAccessory.findMany({
        where: { bookingId: booking.id },
        include: { accessory: { select: { id: true, name: true, taxClassificationId: true } } },
        orderBy: [{ createdAt: 'asc' }, { accessory: { name: 'asc' } }, { id: 'asc' }],
      });
      const mappingRows = await this.prisma.taxComponentMapping.findMany({ where: { companyId } });
      const mappings: Partial<Record<TaxMappedComponent, string>> = {};
      for (const m of mappingRows) mappings[m.componentType] = m.classificationId;

      const { variant } = booking.unit;
      const components: SaleTaxComponents = {
        exShowroom: booking.exShowroom,
        discount: booking.discount,
        exchangeValue: booking.exchangeValue,
        accessoriesTotal: booking.accessoriesTotal,
        rto: booking.rto,
        insuranceCharge: booking.insuranceCharge,
        registration: booking.registration,
        extendedWarranty: booking.extendedWarranty,
        taxAmount: booking.taxAmount,
        vehicle: {
          sourceId: booking.unitId,
          description: `${variant.model.brand} ${variant.model.name} ${variant.name} (${variant.colour})`,
          classificationId: variant.model.taxClassificationId,
        },
        accessories: accessoryRows.map((r) => ({ rowId: r.id, accessoryId: r.accessory.id, name: r.accessory.name, qty: r.qty, unitPrice: r.unitPrice, classificationId: r.accessory.taxClassificationId })),
        mappings,
        discountTreatment: setting.gstDiscountTreatment,
        exchangeTreatment: setting.gstExchangeTreatment,
      };
      const plan = planSaleTaxLines(components);

      // Every booking amount is GST-inclusive: the engine extracts tax, the gross never changes.
      // The engine scopes every classification / rate lookup to this company explicitly.
      const result = await this.engine.calculate(companyId, {
        asOf,
        supplyType: supply.supplyType,
        lines: plan.lines.map((l) => ({ key: l.key, classificationId: l.classificationId, amount: l.amount, pricingMode: PricingMode.INCLUSIVE })),
      });

      const documentTotal = reconcileToCommercialTotal(result.totals.totalGross, plan, booking.total);
      const byKey = new Map(result.lines.map((l) => [l.key, l]));
      return {
        companyId,
        asOf,
        supplyType: supply.supplyType,
        supplierGstin,
        supplierStateCode: supply.supplierStateCode,
        placeOfSupplyStateCode: supply.placeOfSupplyStateCode,
        discountTreatment: plan.discountTreatment,
        exchangeTreatment: plan.exchangeTreatment,
        discountAmount: plan.discountAmount,
        exchangeAmount: plan.exchangeAmount,
        documentTotal,
        result,
        lines: plan.lines.map((p) => ({ plan: p, result: byKey.get(p.key)! })),
      };
    } catch (e) {
      throw toSaleTaxException(e);
    }
  }

  /** Writes the snapshot + lines. MUST run inside the transaction that creates the Sale. */
  async persist(tx: Tx, saleId: string, prepared: PreparedSaleTax, userId: string): Promise<void> {
    const { totals } = prepared.result;
    await tx.taxSnapshot.create({
      data: {
        companyId: prepared.companyId,
        saleId,
        engineVersion: prepared.result.engineVersion,
        asOf: new Date(`${prepared.asOf}T00:00:00.000Z`),
        supplyType: prepared.supplyType,
        supplierGstin: prepared.supplierGstin,
        supplierStateCode: prepared.supplierStateCode,
        placeOfSupplyStateCode: prepared.placeOfSupplyStateCode,
        discountTreatment: prepared.discountTreatment,
        exchangeTreatment: prepared.exchangeTreatment,
        discountAmount: prepared.discountAmount,
        exchangeAmount: prepared.exchangeAmount,
        totalGross: totals.totalGross,
        totalTaxable: totals.totalTaxable,
        totalCGST: totals.totalCGST,
        totalSGST: totals.totalSGST,
        totalIGST: totals.totalIGST,
        totalTax: totals.totalTax,
        totalRoundOff: totals.totalRoundOff,
        documentTotal: prepared.documentTotal,
        createdById: userId,
        lines: {
          // companyId is set explicitly: the tenant middleware does not reach nested creates.
          create: prepared.lines.map(({ plan, result }, index) => ({
            companyId: prepared.companyId,
            lineKey: plan.key,
            position: index + 1,
            componentType: plan.componentType satisfies TaxLineComponent,
            description: plan.description,
            sourceId: plan.sourceId,
            quantity: plan.quantity,
            unitAmount: plan.unitAmount,
            // Copied values — the historical truth, independent of later master-data changes.
            classificationId: result.classificationId,
            classificationName: result.classificationName,
            codeType: result.codeType,
            code: result.code,
            treatment: result.treatment,
            ratePercent: result.ratePercent === null ? null : new Prisma.Decimal(result.ratePercent),
            pricingMode: result.pricingMode,
            grossAmount: result.grossAmount,
            taxableAmount: result.taxableAmount,
            cgst: result.cgst,
            sgst: result.sgst,
            igst: result.igst,
            taxTotal: result.taxTotal,
            roundOff: result.roundOff,
          })),
        },
      },
    });
  }
}
