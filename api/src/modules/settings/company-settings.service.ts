import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CompanySetting } from '@prisma/client';
import {
  ActivityAction,
  BackupFrequency,
  gstActivationBlockers,
  type CompanySettingsDto,
  type UpdateCompanySettingsInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /** Raw settings entity for the current company — created with defaults if missing. */
  async getSettings(): Promise<CompanySetting> {
    const existing = await this.prisma.companySetting.findFirst();
    if (existing) return existing;
    // companyId is injected by the tenant middleware.
    return this.prisma.companySetting.create({ data: {} });
  }

  async getDto(): Promise<CompanySettingsDto> {
    return this.toDto(await this.getSettings());
  }

  /** Public-to-all-roles branding subset — drives app-wide theming and the logo. */
  async getBranding(): Promise<{ businessName: string; primaryColor: string; secondaryColor: string; companyLogoUrl: string | null }> {
    const s = await this.getSettings();
    return {
      businessName: s.businessName,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      companyLogoUrl: s.companyLogo ? this.storage.urlFor(s.companyLogo) : null,
    };
  }

  async update(dto: UpdateCompanySettingsInput, userId: string): Promise<CompanySettingsDto> {
    const current = await this.getSettings();
    // Money settings arrive as integer paise but are stored as BigInt.
    const { openingCash, openingBank, lowCashThreshold, largeExpenseThreshold, ...rest } = dto;

    // GST registration. An empty GSTIN clears it. GST can only be (or stay) enabled with a well-formed
    // GSTIN and a matching two-digit state code — checked here, on the resulting state, whenever a
    // request touches the registration. This is the backend gate; the UI check is a convenience.
    const gstNumber = dto.gstNumber === undefined ? undefined : dto.gstNumber === '' ? null : dto.gstNumber;
    const touchesGstRegistration = dto.gstEnabled !== undefined || dto.gstNumber !== undefined || dto.gstStateCode !== undefined;
    if (touchesGstRegistration && (dto.gstEnabled ?? current.gstEnabled)) {
      const blockers = gstActivationBlockers({
        gstNumber: gstNumber === undefined ? current.gstNumber : gstNumber,
        gstStateCode: dto.gstStateCode === undefined ? current.gstStateCode : dto.gstStateCode,
      });
      if (blockers.length > 0) throw new BadRequestException(`GST cannot be enabled: ${blockers.join('; ')}`);
    }

    const updated = await this.prisma.companySetting.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(gstNumber !== undefined ? { gstNumber } : {}),
        ...(openingCash !== undefined ? { openingCash: BigInt(openingCash) } : {}),
        ...(openingBank !== undefined ? { openingBank: BigInt(openingBank) } : {}),
        ...(lowCashThreshold !== undefined ? { lowCashThreshold: BigInt(lowCashThreshold) } : {}),
        ...(largeExpenseThreshold !== undefined ? { largeExpenseThreshold: BigInt(largeExpenseThreshold) } : {}),
        email: dto.email === '' ? null : dto.email,
        updatedById: userId,
      },
    });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'CompanySetting',
      entityId: updated.id,
      summary: 'Updated company settings',
    });
    await this.auditGstChanges(current, updated, userId);
    return this.toDto(updated);
  }

  /** A dedicated audit entry (old → new) whenever a GST setting actually changes. */
  private async auditGstChanges(before: CompanySetting, after: CompanySetting, userId: string): Promise<void> {
    const fields = ['gstEnabled', 'gstNumber', 'gstStateCode', 'gstDiscountTreatment', 'gstExchangeTreatment'] as const;
    const changes: Record<string, { from: string | boolean | null; to: string | boolean | null }> = {};
    for (const f of fields) if (before[f] !== after[f]) changes[f] = { from: before[f], to: after[f] };
    const changed = Object.keys(changes);
    if (changed.length === 0) return;
    const show = (v: string | boolean | null): string => (v === null ? '—' : String(v));
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'CompanySetting',
      entityId: after.id,
      summary: `GST settings changed: ${changed.map((f) => `${f} ${show(changes[f]!.from)} → ${show(changes[f]!.to)}`).join('; ')}`,
      metadata: { gstChanges: changes },
    });
  }

  async setImage(kind: 'companyLogo' | 'favicon', file: UploadedFile, userId: string): Promise<CompanySettingsDto> {
    const current = await this.getSettings();
    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: 'branding',
    });
    const oldKey = current[kind];
    const updated = await this.prisma.companySetting.update({
      where: { id: current.id },
      data: { [kind]: stored.fileKey, updatedById: userId },
    });
    if (oldKey) await this.storage.remove(oldKey).catch(() => undefined);
    return this.toDto(updated);
  }

  async removeImage(kind: 'companyLogo' | 'favicon', userId: string): Promise<CompanySettingsDto> {
    const current = await this.getSettings();
    if (current[kind]) await this.storage.remove(current[kind] as string).catch(() => undefined);
    const updated = await this.prisma.companySetting.update({
      where: { id: current.id },
      data: { [kind]: null, updatedById: userId },
    });
    return this.toDto(updated);
  }

  private toDto(s: CompanySetting): CompanySettingsDto {
    return {
      id: s.id,
      businessName: s.businessName,
      legalName: s.legalName,
      dealerName: s.dealerName,
      address: s.address,
      city: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      website: s.website,
      tagline: s.tagline,
      currency: s.currency,
      timezone: s.timezone,
      language: s.language,
      dateFormat: s.dateFormat,
      timeFormat: s.timeFormat,
      gstEnabled: s.gstEnabled,
      gstNumber: s.gstNumber,
      gstStateCode: s.gstStateCode,
      gstDiscountTreatment: s.gstDiscountTreatment,
      gstExchangeTreatment: s.gstExchangeTreatment,
      taxPercentage: s.taxPercentage.toString(),
      invoicePrefix: s.invoicePrefix,
      bookingPrefix: s.bookingPrefix,
      quotationPrefix: s.quotationPrefix,
      receiptPrefix: s.receiptPrefix,
      jobCardPrefix: s.jobCardPrefix,
      defaultWarrantyMonths: s.defaultWarrantyMonths,
      serviceReminderDays: s.serviceReminderDays,
      warrantyEnabled: s.warrantyEnabled,
      amcEnabled: s.amcEnabled,
      warrantyReminderDays: s.warrantyReminderDays,
      financeEnabled: s.financeEnabled,
      expensePrefix: s.expensePrefix,
      vendorPrefix: s.vendorPrefix,
      incomePrefix: s.incomePrefix,
      bankPrefix: s.bankPrefix,
      financeGstRate: Number(s.financeGstRate),
      financialYearStartMonth: s.financialYearStartMonth,
      openingCash: String(s.openingCash),
      openingBank: String(s.openingBank),
      lowCashThreshold: String(s.lowCashThreshold),
      largeExpenseThreshold: String(s.largeExpenseThreshold),
      freeService1Km: s.freeService1Km,
      freeService1Days: s.freeService1Days,
      freeService2Km: s.freeService2Km,
      freeService2Days: s.freeService2Days,
      freeService3Km: s.freeService3Km,
      freeService3Days: s.freeService3Days,
      companyLogo: s.companyLogo,
      companyLogoUrl: s.companyLogo ? this.storage.urlFor(s.companyLogo) : null,
      favicon: s.favicon,
      faviconUrl: s.favicon ? this.storage.urlFor(s.favicon) : null,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      workingDays: s.workingDays,
      workingHours: s.workingHours,
      notifyDelivery: s.notifyDelivery,
      notifyPayment: s.notifyPayment,
      notifyService: s.notifyService,
      notifyInventory: s.notifyInventory,
      notifyWarranty: s.notifyWarranty,
      desktopNotifications: s.desktopNotifications,
      emailEnabled: s.emailEnabled,
      smsEnabled: s.smsEnabled,
      whatsappEnabled: s.whatsappEnabled,
      backupEnabled: s.backupEnabled,
      backupFrequency: s.backupFrequency as BackupFrequency,
      termsAndConditions: s.termsAndConditions,
      invoiceFooter: s.invoiceFooter,
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
