import { weightedAvgCost } from './inventory-cost';

describe('weightedAvgCost (accessory moving average)', () => {
  it('sets the average to the incoming cost when there is no prior stock', () => {
    // 10 helmets @ ₹800 into empty stock → ₹800 avg.
    expect(weightedAvgCost(0, 0n, 10, 80000n)).toBe(80000n);
  });

  it('blends prior stock and a new purchase by quantity', () => {
    // 10 @ ₹800 then 10 @ ₹1000 → (800000 + 1000000) / 20 = ₹900.
    expect(weightedAvgCost(10, 80000n, 10, 100000n)).toBe(90000n);
  });

  it('weights by quantity, not by lot', () => {
    // 90 @ ₹100 + 10 @ ₹200 → (900000 + 200000) / 100 = ₹110.
    expect(weightedAvgCost(90, 10000n, 10, 20000n)).toBe(11000n);
  });

  it('rounds half-up to the nearest paisa', () => {
    // 3 @ 100p + 1 @ 150p → 450 / 4 = 112.5p → 113p.
    expect(weightedAvgCost(3, 100n, 1, 150n)).toBe(113n);
  });

  it('is a no-op for a non-positive incoming quantity', () => {
    expect(weightedAvgCost(5, 50000n, 0, 99999n)).toBe(50000n);
    expect(weightedAvgCost(5, 50000n, -3, 99999n)).toBe(50000n);
  });

  it('treats negative on-hand as zero (defensive)', () => {
    expect(weightedAvgCost(-4, 50000n, 2, 70000n)).toBe(70000n);
  });
});
