import { Inject, Injectable } from '@nestjs/common';
import { CompanySetting } from '@prisma/client';
import {
  ActivityAction,
  BackupFrequency,
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
    const updated = await this.prisma.companySetting.update({
      where: { id: current.id },
      data: {
        ...dto,
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
    return this.toDto(updated);
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
      address: s.address,
      city: s.city,
      state: s.state,
      phone: s.phone,
      email: s.email,
      currency: s.currency,
      timezone: s.timezone,
      language: s.language,
      dateFormat: s.dateFormat,
      timeFormat: s.timeFormat,
      gstEnabled: s.gstEnabled,
      gstNumber: s.gstNumber,
      taxPercentage: s.taxPercentage.toString(),
      invoicePrefix: s.invoicePrefix,
      bookingPrefix: s.bookingPrefix,
      quotationPrefix: s.quotationPrefix,
      receiptPrefix: s.receiptPrefix,
      jobCardPrefix: s.jobCardPrefix,
      defaultWarrantyMonths: s.defaultWarrantyMonths,
      serviceReminderDays: s.serviceReminderDays,
      companyLogo: s.companyLogo,
      companyLogoUrl: s.companyLogo ? this.storage.urlFor(s.companyLogo) : null,
      favicon: s.favicon,
      faviconUrl: s.favicon ? this.storage.urlFor(s.favicon) : null,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      workingDays: s.workingDays,
      workingHours: s.workingHours,
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
