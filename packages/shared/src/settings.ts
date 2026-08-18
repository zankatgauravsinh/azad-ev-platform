import { z } from 'zod';
import { BackupFrequency, BACKUP_FREQUENCIES } from './enums';

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const TIME_FORMATS = ['12h', '24h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export const LANGUAGES = ['en', 'hi', 'gu'] as const;
export type Language = (typeof LANGUAGES)[number];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const CURRENCIES = ['INR', 'USD', 'EUR', 'AED', 'GBP'] as const;

const hexColor = z.string().trim().regex(/^#([0-9a-fA-F]{6})$/, 'Use a #RRGGBB colour');
const prefix = (label: string) => z.string().trim().min(1, `${label} is required`).max(12).regex(/^[A-Za-z0-9/-]+$/, 'Letters, numbers, / and - only');
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Strongly-typed partial update for company settings (every field validated). */
export const updateCompanySettingsSchema = z
  .object({
    // Business
    businessName: z.string().trim().min(1, 'Business name is required').max(120).optional(),
    legalName: optionalText(120),
    dealerName: optionalText(150),
    address: optionalText(300),
    city: optionalText(80),
    state: optionalText(80),
    phone: z.string().trim().max(80).optional(),
    email: z.string().trim().email('Invalid email').or(z.literal('')).optional(),
    website: optionalText(150),
    tagline: z.string().trim().max(60).optional(),
    // Localization
    currency: z.enum(CURRENCIES).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    language: z.enum(LANGUAGES).optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    timeFormat: z.enum(TIME_FORMATS).optional(),
    // GST / tax
    gstEnabled: z.boolean().optional(),
    gstNumber: z.string().trim().max(20).optional(),
    taxPercentage: z.coerce.number().min(0).max(100).optional(),
    // Prefixes
    invoicePrefix: prefix('Invoice prefix').optional(),
    bookingPrefix: prefix('Booking prefix').optional(),
    quotationPrefix: prefix('Quotation prefix').optional(),
    receiptPrefix: prefix('Receipt prefix').optional(),
    jobCardPrefix: prefix('Job card prefix').optional(),
    // Sales / Service
    defaultWarrantyMonths: z.coerce.number().int().min(0).max(240).optional(),
    serviceReminderDays: z.coerce.number().int().min(0).max(365).optional(),
    // Warranty & AMC (Module 8)
    warrantyEnabled: z.boolean().optional(),
    amcEnabled: z.boolean().optional(),
    warrantyReminderDays: z.coerce.number().int().min(1).max(365).optional(),
    // Finance (Module 9)
    financeEnabled: z.boolean().optional(),
    expensePrefix: prefix('Expense prefix').optional(),
    vendorPrefix: prefix('Vendor prefix').optional(),
    incomePrefix: prefix('Income prefix').optional(),
    bankPrefix: prefix('Bank prefix').optional(),
    financeGstRate: z.coerce.number().min(0).max(100).optional(),
    financialYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
    openingCash: z.coerce.number().int().min(0).optional(),
    openingBank: z.coerce.number().int().min(0).optional(),
    lowCashThreshold: z.coerce.number().int().min(0).optional(),
    largeExpenseThreshold: z.coerce.number().int().min(0).optional(),
    freeService1Km: z.coerce.number().int().min(0).max(100000).optional(),
    freeService1Days: z.coerce.number().int().min(0).max(3650).optional(),
    freeService2Km: z.coerce.number().int().min(0).max(100000).optional(),
    freeService2Days: z.coerce.number().int().min(0).max(3650).optional(),
    freeService3Km: z.coerce.number().int().min(0).max(100000).optional(),
    freeService3Days: z.coerce.number().int().min(0).max(3650).optional(),
    // Branding
    primaryColor: hexColor.optional(),
    secondaryColor: hexColor.optional(),
    // Business hours
    workingDays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    workingHours: z.string().trim().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Use HH:MM-HH:MM').optional(),
    // Notifications
    notifyDelivery: z.boolean().optional(),
    notifyPayment: z.boolean().optional(),
    notifyService: z.boolean().optional(),
    notifyInventory: z.boolean().optional(),
    notifyWarranty: z.boolean().optional(),
    desktopNotifications: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    whatsappEnabled: z.boolean().optional(),
    // Backup
    backupEnabled: z.boolean().optional(),
    backupFrequency: z.enum(BACKUP_FREQUENCIES as [BackupFrequency, ...BackupFrequency[]]).optional(),
    // Invoice
    termsAndConditions: optionalText(2000),
    invoiceFooter: optionalText(500),
  })
  .refine((v) => !v.gstEnabled || (v.gstNumber && v.gstNumber.trim().length > 0), {
    message: 'A GST number is required when GST is enabled',
    path: ['gstNumber'],
  });
export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;

export interface CompanySettingsDto {
  id: string;
  businessName: string;
  legalName: string;
  dealerName: string | null;
  address: string | null;
  city: string;
  state: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  tagline: string;
  currency: string;
  timezone: string;
  language: string;
  dateFormat: string;
  timeFormat: string;
  gstEnabled: boolean;
  gstNumber: string | null;
  taxPercentage: string;
  invoicePrefix: string;
  bookingPrefix: string;
  quotationPrefix: string;
  receiptPrefix: string;
  jobCardPrefix: string;
  defaultWarrantyMonths: number;
  serviceReminderDays: number;
  warrantyEnabled: boolean;
  amcEnabled: boolean;
  warrantyReminderDays: number;
  financeEnabled: boolean;
  expensePrefix: string;
  vendorPrefix: string;
  incomePrefix: string;
  bankPrefix: string;
  financeGstRate: number;
  financialYearStartMonth: number;
  openingCash: string;
  openingBank: string;
  lowCashThreshold: string;
  largeExpenseThreshold: string;
  freeService1Km: number;
  freeService1Days: number;
  freeService2Km: number;
  freeService2Days: number;
  freeService3Km: number;
  freeService3Days: number;
  companyLogo: string | null;
  companyLogoUrl: string | null;
  favicon: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  workingDays: string[];
  workingHours: string;
  notifyDelivery: boolean;
  notifyPayment: boolean;
  notifyService: boolean;
  notifyInventory: boolean;
  notifyWarranty: boolean;
  desktopNotifications: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  backupEnabled: boolean;
  backupFrequency: BackupFrequency;
  termsAndConditions: string | null;
  invoiceFooter: string | null;
  updatedAt: string;
}

/** UI section grouping — one tab per group. */
export const SETTING_GROUPS = [
  'general',
  'branding',
  'sales',
  'invoice',
  'service',
  'notifications',
  'localization',
  'backup',
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];
