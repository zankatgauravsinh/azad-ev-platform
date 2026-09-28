/**
 * Weighted-average moving cost for accessory inventory. All money is integer paise (BigInt),
 * quantities are whole units. Costs are ex-GST (GST is tracked separately as input tax).
 *
 *   newAvg = round( (onHand · avgCost + inQty · inUnitCost) / (onHand + inQty) )
 *
 * Rounding is half-up to the nearest paisa. Inputs are expected non-negative; a non-positive
 * incoming quantity is a no-op that leaves the current average unchanged.
 */
export function weightedAvgCost(onHand: number, avgCost: bigint, inQty: number, inUnitCost: bigint): bigint {
  if (inQty <= 0) return avgCost;
  const existingQty = onHand > 0 ? BigInt(onHand) : 0n;
  const incomingQty = BigInt(inQty);
  const totalQty = existingQty + incomingQty;
  if (totalQty <= 0n) return inUnitCost;
  const totalValue = existingQty * avgCost + incomingQty * inUnitCost;
  // Half-up rounding for non-negative values.
  return (totalValue + totalQty / 2n) / totalQty;
}
