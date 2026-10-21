import { auditValue, changesSummary, createdFields, diffFields } from './audit-diff';

describe('audit-diff', () => {
  it('records only what changed, money as paise strings and dates as ISO text', () => {
    const before = { price: 12_000_000n, colour: 'Red', delivered: new Date('2026-10-01T00:00:00.000Z'), notes: null as string | null };
    const after = { price: 11_500_000n, colour: 'Red', delivered: new Date('2026-10-02T00:00:00.000Z'), notes: 'ok' };
    expect(diffFields(before, after, ['price', 'colour', 'delivered', 'notes'])).toEqual({
      price: { from: '12000000', to: '11500000' },
      delivered: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
      notes: { from: null, to: 'ok' },
    });
  });

  it('never records secrets and masks Aadhaar numbers', () => {
    const before = { passwordHash: 'a', refreshTokenHash: 'x', aadhaarNumber: '234567890123' };
    const after = { passwordHash: 'b', refreshTokenHash: 'y', aadhaarNumber: '987654321098' };
    const changes = diffFields(before, after, ['passwordHash', 'refreshTokenHash', 'aadhaarNumber']);
    expect(Object.keys(changes)).toEqual(['aadhaarNumber']);
    expect(JSON.stringify(changes)).not.toContain('234567890123');
    expect(changes.aadhaarNumber!.to).toMatch(/1098$/);
    expect(createdFields({ password: 'p', name: 'Ravi', extra: undefined })).toEqual({ name: { from: null, to: 'Ravi' } });
  });

  it('the summary names purchase-cost fields without their values', () => {
    const text = changesSummary({ purchaseCost: { from: '100', to: '200' }, sellingPrice: { from: '300', to: '400' } }, { sellingPrice: 'selling price' });
    expect(text).toBe('purchaseCost changed; selling price 300 → 400');
  });

  it('objects become capped JSON text', () => {
    expect(auditValue({ a: 1n })).toBe('{"a":"1"}');
    expect(String(auditValue({ s: 'x'.repeat(600) })).endsWith('…')).toBe(true);
  });
});
