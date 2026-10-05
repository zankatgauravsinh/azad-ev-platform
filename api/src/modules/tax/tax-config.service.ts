import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TaxClassification } from '@prisma/client';
import {
  ActivityAction,
  TAX_MAPPED_COMPONENTS,
  gstActivationBlockers,
  isGstStateCode,
  isWellFormedGstin,
  type GstReadinessDto,
  type ProductTaxClassificationDto,
  type SetComponentMappingInput,
  type SetProductTaxClassificationInput,
  type TaxClassificationRef,
  type TaxComponentMappingDto,
  type TaxMappedComponent,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { periodCovers, toCalendarDate } from './tax-calendar';
import { calendarDateInTimeZone } from './tax-point';

/**
 * GST configuration administration (Stage C.1): which classification a scooter model, an accessory or
 * a scalar booking component uses, plus an informational readiness summary.
 *
 *  - Configuration only. Nothing here calculates tax, and nothing here touches a Sale or a TaxSnapshot —
 *    a change affects FUTURE invoices only.
 *  - Tenant-safe: the company comes from the request context and is put in every query explicitly, so
 *    another company's model, accessory or classification is simply not found.
 *  - A classification can be assigned only if it belongs to this company, is not archived and is active.
 *  - No defaults: nothing is assigned or mapped automatically.
 */
@Injectable()
export class TaxConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Component mappings ───────────────────────────────────
  async listComponentMappings(): Promise<TaxComponentMappingDto[]> {
    return this.loadMappings(this.tenant.requireCompanyId());
  }

  async setComponentMapping(component: TaxMappedComponent, dto: SetComponentMappingInput, userId: string): Promise<TaxComponentMappingDto> {
    const companyId = this.tenant.requireCompanyId();
    const classification = await this.loadUsableClassification(companyId, dto.classificationId);
    const existing = await this.prisma.taxComponentMapping.findFirst({ where: { companyId, componentType: component } });
    // One row per (company, component): replace in place rather than add a second.
    await this.prisma.taxComponentMapping.upsert({
      where: { companyId_componentType: { companyId, componentType: component } },
      create: { companyId, componentType: component, classificationId: classification.id, createdById: userId, updatedById: userId },
      update: { classificationId: classification.id, updatedById: userId },
    });
    await this.activityLog.record({
      actorId: userId,
      action: existing ? ActivityAction.UPDATE : ActivityAction.CREATE,
      entityType: 'TaxComponentMapping',
      entityId: component,
      summary: `GST mapping for ${component} set to "${classification.name}"`,
      metadata: { component, fromClassificationId: existing?.classificationId ?? null, toClassificationId: classification.id },
    });
    return { component, classification: TaxConfigService.toRef(classification), usable: true };
  }

  async clearComponentMapping(component: TaxMappedComponent, userId: string): Promise<TaxComponentMappingDto> {
    const companyId = this.tenant.requireCompanyId();
    const existing = await this.prisma.taxComponentMapping.findFirst({ where: { companyId, componentType: component } });
    if (existing) {
      // Clearing only affects future invoices: one that carries this component will be refused until it is mapped again.
      await this.prisma.taxComponentMapping.deleteMany({ where: { companyId, componentType: component } });
      await this.activityLog.record({
        actorId: userId,
        action: ActivityAction.DELETE,
        entityType: 'TaxComponentMapping',
        entityId: component,
        summary: `GST mapping for ${component} cleared`,
        metadata: { component, fromClassificationId: existing.classificationId, toClassificationId: null },
      });
    }
    return { component, classification: null, usable: false };
  }

  // ── Product classification ───────────────────────────────
  async setScooterModelClassification(modelId: string, dto: SetProductTaxClassificationInput, userId: string): Promise<ProductTaxClassificationDto> {
    const companyId = this.tenant.requireCompanyId();
    const model = await this.prisma.scooterModel.findFirst({ where: { id: modelId, companyId } });
    if (!model) throw new NotFoundException('Scooter model not found');
    const classification = dto.taxClassificationId === null ? null : await this.loadUsableClassification(companyId, dto.taxClassificationId);
    await this.prisma.scooterModel.update({ where: { id: model.id }, data: { taxClassificationId: classification?.id ?? null, updatedById: userId } });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'ScooterModel',
      entityId: model.id,
      summary: classification ? `GST classification of model ${model.name} set to "${classification.name}"` : `GST classification of model ${model.name} cleared`,
      metadata: { fromClassificationId: model.taxClassificationId, toClassificationId: classification?.id ?? null },
    });
    return { id: model.id, taxClassificationId: classification?.id ?? null };
  }

  async setAccessoryClassification(accessoryId: string, dto: SetProductTaxClassificationInput, userId: string): Promise<ProductTaxClassificationDto> {
    const companyId = this.tenant.requireCompanyId();
    const accessory = await this.prisma.accessory.findFirst({ where: { id: accessoryId, companyId } });
    if (!accessory) throw new NotFoundException('Accessory not found');
    const classification = dto.taxClassificationId === null ? null : await this.loadUsableClassification(companyId, dto.taxClassificationId);
    await this.prisma.accessory.update({ where: { id: accessory.id }, data: { taxClassificationId: classification?.id ?? null, updatedById: userId } });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'Accessory',
      entityId: accessory.id,
      summary: classification ? `GST classification of accessory ${accessory.name} set to "${classification.name}"` : `GST classification of accessory ${accessory.name} cleared`,
      metadata: { fromClassificationId: accessory.taxClassificationId, toClassificationId: classification?.id ?? null },
    });
    return { id: accessory.id, taxClassificationId: classification?.id ?? null };
  }

  // ── Readiness (informational — sale-time validation is the enforcement point) ──
  async readiness(): Promise<GstReadinessDto> {
    const companyId = this.tenant.requireCompanyId();
    const setting = await this.prisma.companySetting.findFirst({
      where: { companyId },
      select: { gstEnabled: true, gstNumber: true, gstStateCode: true, timezone: true, gstDiscountTreatment: true, gstExchangeTreatment: true },
    });
    const gstin = setting?.gstNumber?.trim() ?? '';
    const stateCode = setting?.gstStateCode?.trim() ?? '';
    const blockers = gstActivationBlockers({ gstNumber: gstin, gstStateCode: stateCode });

    const [componentMappings, taxable, activeClassifications, modelsTotal, modelsClassified, accessoriesTotal, accessoriesClassified] = await Promise.all([
      this.loadMappings(companyId),
      this.prisma.taxClassification.findMany({
        where: { companyId, deletedAt: null, isActive: true, treatment: 'TAXABLE' },
        select: { rates: { where: { isActive: true }, select: { effectiveFrom: true, effectiveTo: true } } },
      }),
      this.prisma.taxClassification.count({ where: { companyId, deletedAt: null, isActive: true } }),
      this.prisma.scooterModel.count({ where: { companyId, isActive: true } }),
      this.prisma.scooterModel.count({ where: { companyId, isActive: true, taxClassificationId: { not: null } } }),
      this.prisma.accessory.count({ where: { companyId, isActive: true } }),
      this.prisma.accessory.count({ where: { companyId, isActive: true, taxClassificationId: { not: null } } }),
    ]);

    const today = this.today(setting?.timezone);
    const taxableWithoutCurrentRate = taxable.filter(
      (c) => !c.rates.some((r) => periodCovers(toCalendarDate(r.effectiveFrom), r.effectiveTo ? toCalendarDate(r.effectiveTo) : null, today)),
    ).length;

    return {
      gstEnabled: setting?.gstEnabled ?? false,
      registration: {
        gstinPresent: gstin !== '',
        gstinWellFormed: isWellFormedGstin(gstin),
        stateCodePresent: stateCode !== '',
        stateCodeValid: isGstStateCode(stateCode),
        stateCodeMatchesGstin: isWellFormedGstin(gstin) && isGstStateCode(stateCode) ? gstin.startsWith(stateCode) : null,
      },
      canEnable: blockers.length === 0,
      blockers,
      discountTreatment: setting?.gstDiscountTreatment ?? null,
      exchangeTreatment: setting?.gstExchangeTreatment ?? null,
      componentMappings,
      classifications: { active: activeClassifications, taxableWithoutCurrentRate },
      scooterModels: { total: modelsTotal, classified: modelsClassified, missing: modelsTotal - modelsClassified },
      accessories: { total: accessoriesTotal, classified: accessoriesClassified, missing: accessoriesTotal - accessoriesClassified },
    };
  }

  // ── internals ────────────────────────────────────────────
  /** All four components, mapped or not, in a fixed order. */
  private async loadMappings(companyId: string): Promise<TaxComponentMappingDto[]> {
    const rows = await this.prisma.taxComponentMapping.findMany({ where: { companyId }, include: { classification: true } });
    return TAX_MAPPED_COMPONENTS.map((component) => {
      const row = rows.find((r) => r.componentType === component);
      // A mapping whose classification belongs elsewhere, was archived or deactivated is shown but flagged unusable.
      const c = row && row.classification.companyId === companyId ? row.classification : null;
      return { component, classification: c ? TaxConfigService.toRef(c) : null, usable: c !== null && c.deletedAt === null && c.isActive };
    });
  }

  /** The classification, only if it is this company's, not archived, and active. */
  private async loadUsableClassification(companyId: string, id: string): Promise<TaxClassification> {
    const classification = await this.prisma.taxClassification.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!classification) throw new BadRequestException('Tax classification not found');
    if (!classification.isActive) throw new BadRequestException(`Tax classification "${classification.name}" is inactive`);
    return classification;
  }

  private today(timeZone: string | undefined): string {
    try {
      return calendarDateInTimeZone(new Date(), timeZone ?? 'UTC');
    } catch {
      return toCalendarDate(new Date());
    }
  }

  private static toRef(c: TaxClassification): TaxClassificationRef {
    return { id: c.id, name: c.name, codeType: c.codeType, code: c.code, treatment: c.treatment };
  }
}
