import { computeTotal, sumAccessories } from './pricing';

describe('sales pricing', () => {
  describe('sumAccessories', () => {
    it('sums qty × unitPrice across lines', () => {
      expect(sumAccessories([{ qty: 2, unitPrice: 120000 }, { qty: 1, unitPrice: 50000 }])).toBe(290000n);
    });
    it('is zero for no lines', () => {
      expect(sumAccessories([])).toBe(0n);
    });
  });

  describe('computeTotal', () => {
    const base = {
      exShowroom: 10500000,
      discount: 300000,
      exchangeValue: 0,
      accessoriesTotal: 0,
      rto: 850000,
      insurance: 420000,
      registration: 150000,
      extendedWarranty: 0,
    };

    it('computes on-road as ex-showroom − discount + charges', () => {
      expect(computeTotal(base)).toBe(11620000n);
    });

    it('subtracts exchange value', () => {
      expect(computeTotal({ ...base, exchangeValue: 1000000 })).toBe(10620000n);
    });

    it('adds accessories and tax', () => {
      expect(computeTotal({ ...base, accessoriesTotal: 200000, taxAmount: 100000 })).toBe(11920000n);
    });

    it('rejects a negative total instead of clamping to zero', () => {
      expect(() => computeTotal({ ...base, discount: 99999999 })).toThrow(/exceed the on-road price/);
    });
  });
});
