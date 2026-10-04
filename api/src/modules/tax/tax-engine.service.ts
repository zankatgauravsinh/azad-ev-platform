import { Injectable } from '@nestjs/common';
import { TaxTreatment } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { isCalendarDate, periodCovers, toCalendarDate, type CalendarDate } from './tax-calendar';
import { TaxEngineError, TaxEngineErrorCode } from './tax.errors';
import { assertDocumentShape, computeDocument, toPaise } from './tax-math';
import type { ResolvedTaxLine, ResolvedTaxRate, TaxCalculationRequest, TaxDocumentResult } from './tax.types';

/**
 * GST tax engine (Stage B). Resolves each line's classification + effective-dated rate for a company
 * and delegates the arithmetic to the pure layer (tax-math.ts).
 *
 *  - Side-effect free: it only READS configuration; it never writes, logs business data or persists.
 *  - Fail closed: any problem throws a typed TaxEngineError. There is no fallback to 0%, to
 *    CompanySetting.taxPercentage / financeGstRate, or to any other default.
 *  - Tenant-safe: the company is an explicit argument and every query carries it explicitly, so the
 *    result is correct whether or not a request tenant context is active. If one IS active it must match.
 *  - No production caller yet: nothing in Booking / Sale / invoice / Delivery / Service uses this.
 */
@Injectable()
export class TaxEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  /** The classification + the rate applicable on `asOf` (a 'YYYY-MM-DD' calendar date) for this company. */
  async resolveRate(companyId: string, classificationId: string, asOf: CalendarDate): Promise<ResolvedTaxRate> {
    this.assertScope(companyId);
    if (!isCalendarDate(asOf)) throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, "asOf must be a calendar date in 'YYYY-MM-DD' form");
    await this.assertGstEnabled(companyId);
    return this.resolve(companyId, classificationId, asOf);
  }

  /** Calculates a whole document. All-or-nothing — one failing line fails the entire calculation. */
  async calculate(companyId: string, request: TaxCalculationRequest): Promise<TaxDocumentResult> {
    this.assertScope(companyId);
    if (request === null || typeof request !== 'object') throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'A calculation request is required');
    const ctx = { supplyType: request.supplyType, asOf: request.asOf };
    assertDocumentShape(request.lines, ctx);
    // Reject bad amounts before any I/O.
    for (const line of request.lines) {
      try {
        toPaise(line.amount);
      } catch (e) {
        throw e instanceof TaxEngineError ? e.forLine(line.key) : e;
      }
    }

    await this.assertGstEnabled(companyId);

    const cache = new Map<string, ResolvedTaxRate>();
    const resolved: ResolvedTaxLine[] = [];
    for (const line of request.lines) {
      let rate = cache.get(line.classificationId);
      if (!rate) {
        try {
          rate = await this.resolve(companyId, line.classificationId, request.asOf);
        } catch (e) {
          throw e instanceof TaxEngineError ? e.forLine(line.key) : e;
        }
        cache.set(line.classificationId, rate);
      }
      resolved.push({ ...rate, key: line.key, amount: line.amount, pricingMode: line.pricingMode });
    }

    return computeDocument(resolved, ctx);
  }

  // ── internals ────────────────────────────────────────────

  /** The company must be explicit and must agree with any active request tenant. */
  private assertScope(companyId: string): void {
    if (typeof companyId !== 'string' || companyId.trim() === '') {
      throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'A company scope is required');
    }
    const active = this.tenant.getCompanyId();
    if (active !== null && active !== companyId) {
      throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'Company scope does not match the active tenant');
    }
  }

  private async assertGstEnabled(companyId: string): Promise<void> {
    const setting = await this.prisma.companySetting.findFirst({ where: { companyId }, select: { gstEnabled: true } });
    if (!setting?.gstEnabled) throw new TaxEngineError(TaxEngineErrorCode.GST_DISABLED, 'GST is not enabled for this company');
  }

  private async resolve(companyId: string, classificationId: string, asOf: CalendarDate): Promise<ResolvedTaxRate> {
    const notFound = (): TaxEngineError => new TaxEngineError(TaxEngineErrorCode.CLASSIFICATION_NOT_FOUND, 'Tax classification not found');
    if (typeof classificationId !== 'string' || classificationId === '') throw notFound();

    // Explicit company + not-archived scope: another company's (or a soft-deleted) row is simply not found.
    const classification = await this.prisma.taxClassification.findFirst({ where: { id: classificationId, companyId, deletedAt: null } });
    if (!classification) throw notFound();
    if (!classification.isActive) {
      throw new TaxEngineError(TaxEngineErrorCode.CLASSIFICATION_INACTIVE, `Tax classification "${classification.name}" is inactive`);
    }

    const base = {
      classificationId: classification.id,
      classificationName: classification.name,
      codeType: classification.codeType,
      code: classification.code,
      treatment: classification.treatment,
    };

    // Only a TAXABLE classification carries a rate; the others resolve with no rate at all.
    if (classification.treatment !== TaxTreatment.TAXABLE) return { ...base, ratePercent: null };

    if (classification.code === null || classification.code.trim() === '') {
      throw new TaxEngineError(TaxEngineErrorCode.TAXABLE_WITHOUT_CODE, `Taxable classification "${classification.name}" has no HSN/SAC code`);
    }

    const activeRates = await this.prisma.taxRate.findMany({ where: { classificationId: classification.id, companyId, isActive: true } });
    const matches = activeRates.filter((r) => periodCovers(toCalendarDate(r.effectiveFrom), r.effectiveTo ? toCalendarDate(r.effectiveTo) : null, asOf));
    if (matches.length === 0) {
      throw new TaxEngineError(TaxEngineErrorCode.NO_RATE_FOR_DATE, `No active tax rate for "${classification.name}" on ${asOf}`);
    }
    if (matches.length > 1) {
      throw new TaxEngineError(TaxEngineErrorCode.AMBIGUOUS_RATE, `More than one active tax rate covers ${asOf} for "${classification.name}"`);
    }
    return { ...base, ratePercent: matches[0]!.ratePercent.toFixed(2) };
  }
}
