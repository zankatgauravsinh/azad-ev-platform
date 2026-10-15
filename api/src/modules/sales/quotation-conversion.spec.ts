import { quotationConversionBlocker } from '@azad/shared';

// The rule the API enforces on POST /quotations/:id/convert and the UI uses to offer "Convert to booking".
describe('quotationConversionBlocker', () => {
  const TODAY = '2026-10-13';
  const open = { status: 'SENT' as const, validUntil: null, booking: null };

  it('a draft or sent quotation without a booking converts', () => {
    expect(quotationConversionBlocker(open, TODAY)).toBeNull();
    expect(quotationConversionBlocker({ ...open, status: 'DRAFT' }, TODAY)).toBeNull();
  });

  it('is still valid on its last day, and expired the day after', () => {
    expect(quotationConversionBlocker({ ...open, validUntil: '2026-10-13T00:00:00.000Z' }, TODAY)).toBeNull();
    expect(quotationConversionBlocker({ ...open, validUntil: new Date('2026-10-12T00:00:00.000Z') }, TODAY)).toBe('This quotation expired on 12/10/2026 — duplicate it to quote again');
  });

  it('a cancelled or expired quotation does not convert', () => {
    expect(quotationConversionBlocker({ ...open, status: 'CANCELLED' }, TODAY)).toMatch(/is cancelled/);
    expect(quotationConversionBlocker({ ...open, status: 'EXPIRED' }, TODAY)).toMatch(/has expired/);
  });

  it('converts once — and again only after that booking is cancelled', () => {
    expect(quotationConversionBlocker({ ...open, status: 'ACCEPTED', booking: { status: 'CONFIRMED' } }, TODAY)).toBe('This quotation is already converted to a booking');
    expect(quotationConversionBlocker({ ...open, booking: { status: 'CANCELLED' } }, TODAY)).toBeNull();
  });
});
