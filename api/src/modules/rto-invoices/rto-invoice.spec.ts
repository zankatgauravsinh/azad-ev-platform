import { computeRtoGst, gstRateToBp, generateRtoInvoiceSchema } from '@azad/shared';
import { buildRtoInvoiceDocument } from './rto-invoice-document';

describe('computeRtoGst (GST added on top of the price)', () => {
  it('₹1,00,000 at 5% within the state: CGST 2,500 + SGST 2,500 = total 1,05,000', () => {
    expect(computeRtoGst(10_000_000n, 500, 'INTRA')).toEqual({ taxable: 10_000_000n, cgst: 250_000n, sgst: 250_000n, igst: 0n, gst: 500_000n, total: 10_500_000n });
  });
  it('another state: the whole GST is IGST', () => {
    expect(computeRtoGst(10_000_000n, 500, 'INTER')).toMatchObject({ cgst: 0n, sgst: 0n, igst: 500_000n, total: 10_500_000n });
  });
  it('rounds half-up to the paisa, and CGST + SGST always equal the GST', () => {
    // 333 paise × 5% = 16.65 → 17
    const g = computeRtoGst(333n, 500, 'INTRA');
    expect(g.gst).toBe(17n);
    expect(g.cgst + g.sgst).toBe(17n);
    expect([g.cgst, g.sgst]).toEqual([8n, 9n]);
    expect(computeRtoGst(10_001n, 1800, 'INTRA').gst).toBe(1800n); // 1800.18 → 1800
  });
  it('a 0% rate adds nothing', () => {
    expect(computeRtoGst(5_000_00n, 0, 'INTRA')).toMatchObject({ gst: 0n, total: 5_000_00n });
  });
  it('percent → basis points', () => {
    expect([gstRateToBp(5), gstRateToBp(2.5), gstRateToBp(18), gstRateToBp(0.25)]).toEqual([500, 250, 1800, 25]);
  });
});

describe('generateRtoInvoiceSchema', () => {
  const base = { customerId: '00000000-0000-4000-8000-000000000001', bookingId: '00000000-0000-4000-8000-000000000002', listPrice: 100, discount: 0, gstRate: 5, supplyType: 'INTRA' };
  it('accepts slab and fractional rates up to two decimals', () => {
    for (const gstRate of [0, 5, 12, 18, 28, 2.5, 0.25]) expect(generateRtoInvoiceSchema.safeParse({ ...base, gstRate }).success).toBe(true);
  });
  it('refuses a rate above 28%, negative, or with more than two decimals, and a zero list price', () => {
    for (const gstRate of [28.01, -1, 5.125]) expect(generateRtoInvoiceSchema.safeParse({ ...base, gstRate }).success).toBe(false);
    expect(generateRtoInvoiceSchema.safeParse({ ...base, listPrice: 0 }).success).toBe(false);
  });
  it('the discount defaults to zero and must stay below the list price', () => {
    const { discount: _omit, ...noDiscount } = base;
    void _omit;
    expect(generateRtoInvoiceSchema.parse(noDiscount).discount).toBe(0);
    expect(generateRtoInvoiceSchema.safeParse({ ...base, discount: 99 }).success).toBe(true);
    const refused = generateRtoInvoiceSchema.safeParse({ ...base, discount: 100 });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({ path: ['discount'], message: 'The discount must be less than the list price' });
  });
});

describe('buildRtoInvoiceDocument', () => {
  const identity = {
    dealer: { name: 'AZAD EV POINT', gstin: '24AAJCT0051E1ZT', state: 'Gujarat', stateCode: '24', city: 'Una' },
    customer: { name: 'Asha Patel', phone: '9876543210', address: '4 Lake View', village: 'Panadar', city: 'Kodinar', tehsil: 'Kodinar', district: 'Gir Somnath', state: 'Gujarat', pin: '362720', aadhaarNumber: '234123412346', panNumber: 'ABCDE1234F', gstin: null },
    financeCompany: 'Bajaj Finance',
    vehicle: { make: 'COMPTECH', model: 'MARS', variant: 'Max', colour: 'Sunset Orange', vin: 'VIN1', motorNumber: 'M1', batteryNumber: 'B1', keyNumber: 'PB51' },
    preparedBy: 'Showroom Owner',
    timeZone: 'Asia/Kolkata',
  };
  const figures = { invoiceNumber: 'RTO0001', invoiceDate: new Date('2026-10-15T06:00:00Z'), listPrice: 13_900_000n, discount: 400_000n, sellingPrice: 13_500_000n, gstRateBp: 500, supplyType: 'INTRA' as const, cgst: 337_500n, sgst: 337_500n, igst: 0n, gstAmount: 675_000n, total: 14_175_000n, hsnCode: '87116020', policyNumber: 'POL123456', deliveryDate: '2026-10-14', revision: 1 };
  const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

  it('prints the reference invoice blocks from the stored figures', () => {
    const doc = buildRtoInvoiceDocument(figures, identity);
    expect(doc.title).toBe('TAX INVOICE');
    expect(doc.invoiceDate).toBe('15/10/2026');
    expect(doc.dealerLine).toBe('GSTIN: 24AAJCT0051E1ZT     State: Gujarat (24)     PAN: AAJCT0051E');
    expect(value(doc.customer, 'Village / City')).toBe('Panadar, Kodinar');
    expect(value(doc.customer, 'Aadhaar No.')).toBe('2341 2341 2346');
    expect(value(doc.customer, 'GSTIN No.')).toBe('—');
    expect(value(doc.customer, 'HPA With')).toBe('BAJAJ FINANCE');
    // Booking and sale invoice numbers are not printed.
    expect(doc.references).toEqual([
      { label: 'Invoice No.', value: 'RTO0001' },
      { label: 'Invoice Date', value: '15/10/2026' },
      { label: 'Delivery Date', value: '14/10/2026' },
      { label: 'Policy No.', value: 'POL123456' },
    ]);
    expect(value(doc.vehicle, 'Product Make')).toBe('COMPTECH');
    expect(value(doc.vehicle, 'Chassis No.')).toBe('VIN1');
    expect(value(doc.vehicle, 'Key No.')).toBe('PB51');
    expect(doc.amounts).toEqual([
      { label: 'Basic Price', value: '₹1,35,000.00' },
      { label: 'SGST @ 2.5%', value: '₹3,375.00' },
      { label: 'CGST @ 2.5%', value: '₹3,375.00' },
      { label: 'Total', value: '₹1,41,750.00' },
    ]);
    expect(doc.amountInWords).toBe('Rupees One Lakh Forty-One Thousand Seven Hundred Fifty Only');
    expect(doc.discountNote).toBe('List price ₹1,39,000.00 − Discount ₹4,000.00 = Basic price ₹1,35,000.00');
    expect(doc.jurisdiction).toBe('Subject to Una jurisdiction');
    expect(doc.preparedBy).toBe('Showroom Owner');
  });

  it('SELF without finance, IGST for another state, no discount note, revision shown, gaps as a dash', () => {
    const doc = buildRtoInvoiceDocument(
      { ...figures, discount: 0n, listPrice: 13_500_000n, supplyType: 'INTER', cgst: 0n, sgst: 0n, igst: 675_000n, hsnCode: null, policyNumber: null, deliveryDate: null, revision: 2 },
      { ...identity, financeCompany: null, dealer: { ...identity.dealer, gstin: null, city: null }, customer: { ...identity.customer, aadhaarNumber: null, tehsil: null }, vehicle: { ...identity.vehicle, keyNumber: null } },
    );
    expect(value(doc.customer, 'HPA With')).toBe('SELF');
    expect(doc.amounts.map((a) => a.label)).toEqual(['Basic Price', 'IGST @ 5%', 'Total']);
    expect(doc.discountNote).toBeNull();
    expect(doc.invoiceNumber).toBe('RTO0001'); // the revision is shown in the app, never printed
    expect(doc.dealerLine).toContain('GSTIN: —');
    expect(doc.dealerLine).toContain('PAN: —');
    expect([value(doc.customer, 'Aadhaar No.'), value(doc.customer, 'Tehsil'), value(doc.vehicle, 'Key No.'), value(doc.vehicle, 'HSN Code')]).toEqual(['—', '—', '—', '—']);
    expect(doc.jurisdiction).toBeNull();
    expect([value(doc.references, 'Delivery Date'), value(doc.references, 'Policy No.')]).toEqual(['—', '—']);
  });
});
