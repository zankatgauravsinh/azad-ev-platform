import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { BRAND_LOGO } from './brand-logo';
import type { PdfBrand } from './brand';

/**
 * Resolves the PDF letterhead from Company Settings — the single source of truth
 * for every generated document. Reads the uploaded company logo when present and
 * falls back to the bundled default logo.
 */
@Injectable()
export class PdfBrandService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async resolve(): Promise<PdfBrand> {
    const s = await this.prisma.companySetting.findFirst();
    const cityState = [s?.city, s?.state].filter(Boolean).join(', ');
    const addressLines = [s?.address ?? null, cityState || null].filter((l): l is string => Boolean(l));
    return {
      logo: await this.loadLogo(s?.companyLogo ?? null),
      name: s?.businessName ?? 'AZAD EV POINT',
      dealerName: s?.dealerName ?? null,
      addressLines,
      phones: s?.phone ?? null,
      email: s?.email ?? null,
      website: s?.website ?? null,
      gstin: s?.gstEnabled ? s?.gstNumber ?? null : null,
      tagline: s?.tagline ?? 'POWERING TOMORROW',
      terms: s?.termsAndConditions ?? null,
    };
  }

  private async loadLogo(key: string | null): Promise<Buffer> {
    if (!key) return BRAND_LOGO;
    try {
      return await this.storage.read(key);
    } catch {
      return BRAND_LOGO;
    }
  }
}
