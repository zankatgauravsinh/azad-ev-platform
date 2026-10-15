import { createCustomerSchema, formatAadhaar, isValidAadhaar, isValidGstin, isValidPan, maskAadhaar, panFromGstin } from '@azad/shared';

describe('Aadhaar / PAN / GSTIN', () => {
  it('Aadhaar: 12 digits, not starting with 0 or 1, Verhoeff check digit', () => {
    expect(isValidAadhaar('234123412346')).toBe(true);
    expect(isValidAadhaar('234123412347')).toBe(false); // one digit off
    expect(isValidAadhaar('134123412346')).toBe(false);
    expect(isValidAadhaar('23412341234')).toBe(false);
    expect(formatAadhaar('234123412346')).toBe('2341 2341 2346');
    expect(maskAadhaar('234123412346')).toBe('XXXX XXXX 2346');
  });
  it('PAN and GSTIN (with its check character); the PAN inside a GSTIN', () => {
    expect(isValidPan('AAJCT0051E')).toBe(true);
    expect(isValidPan('AAJCT0051')).toBe(false);
    expect(isValidGstin('24AAJCT0051E1ZT')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('24AAJCT0051E1ZU')).toBe(false);
    expect(panFromGstin('24aajct0051e1zt')).toBe('AAJCT0051E');
    expect(panFromGstin('not a gstin')).toBeNull();
  });
  it('the customer form normalises them, and an empty value clears the field', () => {
    const base = { name: 'Asha', phone: '9876543210' };
    expect(createCustomerSchema.parse({ ...base, aadhaarNumber: '2341 2341 2346', panNumber: 'abcde1234f', gstin: '24aajct0051e1zt' })).toMatchObject({ aadhaarNumber: '234123412346', panNumber: 'ABCDE1234F', gstin: '24AAJCT0051E1ZT' });
    expect(createCustomerSchema.parse({ ...base, aadhaarNumber: '' }).aadhaarNumber).toBeNull();
    expect(createCustomerSchema.safeParse({ ...base, aadhaarNumber: '234123412347' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...base, panNumber: '12345' }).success).toBe(false);
  });
});
