import { computePurchaseCost, createUnitSchema } from '@azad/shared';
import { withoutPurchaseCost } from './purchase-cost.interceptor';

describe('purchase cost', () => {
  it('price + GST worked out from the rate + transport', () => {
    expect(computePurchaseCost(10_000_000n, { rateBp: 500 }, 150_000n)).toEqual({ purchasePrice: 10_000_000n, purchaseGstRateBp: 500, purchaseGst: 500_000n, transportCharge: 150_000n, purchaseCost: 10_650_000n });
  });
  it('a typed GST amount wins over any rate and is kept as an amount', () => {
    expect(computePurchaseCost(10_000_000n, { amount: 512_345n }, 0n)).toMatchObject({ purchaseGstRateBp: null, purchaseGst: 512_345n, purchaseCost: 10_512_345n });
  });
  it('rounds the GST half-up to the paisa', () => {
    expect(computePurchaseCost(333n, { rateBp: 500 }, 0n).purchaseGst).toBe(17n); // 16.65 → 17
  });
  it('a new unit sets the cost only when sent; the controller and charger numbers are normalised', () => {
    const base = { variantId: '00000000-0000-4000-8000-000000000001', vin: 'VIN0001', motorNumber: 'MOT0001', batteryNumber: 'BAT0001' };
    const parsed = createUnitSchema.parse({ ...base, controllerNumber: ' ctl-9 ', chargerNumber: '' });
    expect(parsed).toMatchObject({ controllerNumber: 'CTL-9', chargerNumber: null });
    expect(parsed).not.toHaveProperty('purchasePrice');
  });
});

describe('withoutPurchaseCost', () => {
  it('removes every purchase-cost key at any depth and leaves the rest', () => {
    const body = {
      id: 'b1',
      total: '100',
      unit: { vin: 'V1', purchaseCost: '9', purchasePrice: '8', purchaseGst: '1', purchaseGstRateBp: 500, transportCharge: '0', sellingPrice: '12', variant: { name: 'Pro' } },
      list: [{ purchaseCost: '1', vin: 'V2' }],
      at: new Date('2026-10-16T00:00:00Z'),
    };
    expect(withoutPurchaseCost(body)).toEqual({ id: 'b1', total: '100', unit: { vin: 'V1', sellingPrice: '12', variant: { name: 'Pro' } }, list: [{ vin: 'V2' }], at: new Date('2026-10-16T00:00:00Z') });
  });
  it('passes non-objects and buffers through untouched', () => {
    const buf = Buffer.from('x');
    expect(withoutPurchaseCost(buf)).toBe(buf);
    expect(withoutPurchaseCost(null)).toBeNull();
    expect(withoutPurchaseCost('text')).toBe('text');
  });
});
