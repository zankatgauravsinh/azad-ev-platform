import { serviceBillGst } from './service-gst';

const ctx = { companyStateCode: '24', buyerGstin: null, labourSacCode: '9987', partsHsnCode: '8714' };

describe('serviceBillGst', () => {
  it('intra-state: CGST + SGST on parts + labour − discount, the discount shared in proportion', () => {
    // parts ₹600, labour ₹400, discount ₹100 → taxable ₹900 (parts ₹540, labour ₹360); 18% = ₹162.
    const g = serviceBillGst(60_000n, 40_000n, 10_000n, 1800, ctx);
    expect(g).toMatchObject({ taxable: 90_000n, partsTaxable: 54_000n, labourTaxable: 36_000n, taxAmount: 16_200n, cgst: 8_100n, sgst: 8_100n, igst: 0n, total: 106_200n, placeOfSupplyStateCode: '24' });
    expect(g).toMatchObject({ partsHsnCode: '8714', labourSacCode: '9987' });
  });

  it('rounds the tax half-up to the paisa; an odd paisa goes to SGST', () => {
    const g = serviceBillGst(0n, 1_001n, 0n, 1800, ctx); // 18% of ₹10.01 = 180.18 paise → 180
    expect(g).toMatchObject({ taxAmount: 180n, cgst: 90n, sgst: 90n });
    const h = serviceBillGst(0n, 1_003n, 0n, 1800, ctx); // 180.54 → 181
    expect(h).toMatchObject({ taxAmount: 181n, cgst: 90n, sgst: 91n });
  });

  it('a registered buyer in another state is billed IGST, their state the place of supply', () => {
    const g = serviceBillGst(0n, 100_000n, 0n, 1800, { ...ctx, buyerGstin: '27AAPFU0939F1ZV' });
    expect(g).toMatchObject({ cgst: 0n, sgst: 0n, igst: 18_000n, placeOfSupplyStateCode: '27', buyerGstin: '27AAPFU0939F1ZV' });
  });

  it('a registered buyer in the same state stays intra-state; codes only for what was billed', () => {
    const g = serviceBillGst(0n, 100_000n, 0n, 1800, { ...ctx, buyerGstin: '24AAPFU0939F1ZV' });
    expect(g).toMatchObject({ cgst: 9_000n, sgst: 9_000n, igst: 0n, placeOfSupplyStateCode: '24', partsHsnCode: null, labourSacCode: '9987' });
  });

  it('a discount larger than the bill leaves nothing to tax', () => {
    expect(serviceBillGst(1_000n, 0n, 5_000n, 1800, ctx)).toMatchObject({ taxable: 0n, taxAmount: 0n, total: 0n });
  });
});
