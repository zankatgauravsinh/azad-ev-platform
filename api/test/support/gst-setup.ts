import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { TestCompany } from './e2e-company';

/**
 * Checksum-valid GSTINs for tests (fictitious businesses): the company in Gujarat (24), a registered buyer in
 * Gujarat and one in Maharashtra (27).
 */
export const TEST_GSTIN = { company: '24AABCA1234A1ZP', buyerGujarat: '24AAPFU0939F1Z1', buyerMaharashtra: '27AAPFU0939F1ZV' } as const;

export interface GstSetup {
  vehicleClassId: string;
  accessoryClassId: string;
  serviceClassId: string;
  nonTaxableClassId: string;
}

/**
 * Turns GST on for a test company (state 24), the way GST Management configures it: a 5% vehicle HSN on its
 * model, an 18% accessory HSN, an 18% SAC for extended warranty, and RTO / insurance / registration collected
 * as pure agent (non-taxable). Codes are placeholders for testing, not advice on classification.
 */
export async function enableGst(prisma: PrismaService, co: TestCompany, over: Partial<Prisma.CompanySettingUncheckedUpdateInput> = {}): Promise<GstSetup> {
  await prisma.companySetting.updateMany({
    where: { companyId: co.id },
    data: {
      gstEnabled: true, gstNumber: TEST_GSTIN.company, gstStateCode: '24',
      gstDiscountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT',
      accessoryGstEnabled: true, ...over,
    },
  });
  const from = new Date('2017-07-01T00:00:00.000Z');
  const make = async (name: string, codeType: 'HSN' | 'SAC', code: string, treatment: 'TAXABLE' | 'NON_TAXABLE', rate?: string): Promise<string> => {
    const c = await prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${co.tag}`, codeType, code, treatment } });
    if (rate) await prisma.taxRate.create({ data: { companyId: co.id, classificationId: c.id, ratePercent: new Prisma.Decimal(rate), effectiveFrom: from } });
    return c.id;
  };
  const vehicleClassId = await make('Electric scooter', 'HSN', '87116010', 'TAXABLE', '5');
  const accessoryClassId = await make('Helmet', 'HSN', '65061010', 'TAXABLE', '18');
  const serviceClassId = await make('Extended warranty', 'SAC', '998714', 'TAXABLE', '18');
  const nonTaxableClassId = await make('Pure agent', 'SAC', '9997', 'NON_TAXABLE');
  await prisma.scooterModel.update({ where: { id: co.modelId }, data: { taxClassificationId: vehicleClassId } });
  for (const componentType of ['RTO', 'INSURANCE', 'REGISTRATION'] as const) {
    await prisma.taxComponentMapping.create({ data: { companyId: co.id, componentType, classificationId: nonTaxableClassId } });
  }
  await prisma.taxComponentMapping.create({ data: { companyId: co.id, componentType: 'EXTENDED_WARRANTY', classificationId: serviceClassId } });
  return { vehicleClassId, accessoryClassId, serviceClassId, nonTaxableClassId };
}
