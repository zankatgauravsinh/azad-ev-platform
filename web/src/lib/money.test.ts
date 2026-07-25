import { describe, expect, it } from 'vitest';
import { formatPaise, paiseToRupees, rupeesToPaise } from './money';

describe('money helpers', () => {
  it('formats paise as Indian Rupees', () => {
    expect(formatPaise(12400000)).toBe('₹1,24,000');
    expect(formatPaise('4250000')).toBe('₹42,500');
    expect(formatPaise(0)).toBe('₹0');
  });

  it('converts rupees to paise (rounding safely)', () => {
    expect(rupeesToPaise(1240)).toBe(124000);
    expect(rupeesToPaise(99.99)).toBe(9999);
  });

  it('converts paise back to rupees', () => {
    expect(paiseToRupees(124000)).toBe(1240);
    expect(paiseToRupees('9999')).toBe(99.99);
  });
});
