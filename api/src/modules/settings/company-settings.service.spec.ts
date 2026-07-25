import { CompanySettingsService } from './company-settings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { StorageService } from '../../storage/storage.service';

const baseEntity = {
  id: 'set-1',
  businessName: 'AZAD EV POINT',
  legalName: 'Azad Enterprise',
  address: null,
  city: 'Una',
  state: 'Gujarat',
  phone: null,
  email: null,
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  language: 'en',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12h',
  gstEnabled: false,
  gstNumber: null,
  taxPercentage: { toString: () => '0' },
  invoicePrefix: 'INV',
  bookingPrefix: 'BK',
  quotationPrefix: 'QT',
  receiptPrefix: 'RC',
  jobCardPrefix: 'JC',
  defaultWarrantyMonths: 36,
  serviceReminderDays: 90,
  companyLogo: null,
  favicon: null,
  primaryColor: '#0B2545',
  secondaryColor: '#00B8A9',
  workingDays: ['Mon', 'Tue'],
  workingHours: '10:00-19:00',
  emailEnabled: false,
  smsEnabled: false,
  whatsappEnabled: false,
  backupEnabled: false,
  backupFrequency: 'WEEKLY',
  termsAndConditions: null,
  invoiceFooter: null,
  updatedAt: new Date('2026-07-25T00:00:00Z'),
};

describe('CompanySettingsService', () => {
  let prisma: { companySetting: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let storage: jest.Mocked<Pick<StorageService, 'urlFor' | 'save' | 'remove'>>;
  let service: CompanySettingsService;

  beforeEach(() => {
    prisma = { companySetting: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() } };
    activityLog = { record: jest.fn().mockResolvedValue(undefined) } as never;
    storage = { urlFor: jest.fn((k: string) => `/uploads/${k}`), save: jest.fn(), remove: jest.fn() } as never;
    service = new CompanySettingsService(
      prisma as unknown as PrismaService,
      activityLog as unknown as ActivityLogService,
      storage as unknown as StorageService,
    );
  });

  it('returns existing settings without creating', async () => {
    prisma.companySetting.findFirst.mockResolvedValue(baseEntity);
    const s = await service.getSettings();
    expect(s).toBe(baseEntity);
    expect(prisma.companySetting.create).not.toHaveBeenCalled();
  });

  it('creates default settings when none exist (companyId injected by middleware)', async () => {
    prisma.companySetting.findFirst.mockResolvedValue(null);
    prisma.companySetting.create.mockResolvedValue(baseEntity);
    await service.getSettings();
    expect(prisma.companySetting.create).toHaveBeenCalledWith({ data: {} });
  });

  it('maps to a DTO with logo url and stringified tax', async () => {
    prisma.companySetting.findFirst.mockResolvedValue({ ...baseEntity, companyLogo: 'branding/logo.png', taxPercentage: { toString: () => '5' } });
    const dto = await service.getDto();
    expect(dto.taxPercentage).toBe('5');
    expect(dto.companyLogoUrl).toBe('/uploads/branding/logo.png');
    expect(dto.faviconUrl).toBeNull();
    expect(dto.invoicePrefix).toBe('INV');
  });

  it('updates settings, normalises empty email to null, and records an audit entry', async () => {
    prisma.companySetting.findFirst.mockResolvedValue(baseEntity);
    prisma.companySetting.update.mockResolvedValue({ ...baseEntity, invoicePrefix: 'AZ' });
    await service.update({ invoicePrefix: 'AZ', email: '' }, 'user-1');
    expect(prisma.companySetting.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'set-1' }, data: expect.objectContaining({ invoicePrefix: 'AZ', email: null, updatedById: 'user-1' }) }),
    );
    expect(activityLog.record).toHaveBeenCalled();
  });
});
