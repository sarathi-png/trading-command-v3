/** Carry only unallocated opening costs on the remaining position. */
export function allocatePaperClose(qty: number, closeQty: number, entryFeeCarry: number, price: number, feeRate: number, gross: number) {
  const fraction = closeQty / qty;
  const openingFees = -entryFeeCarry * fraction;
  const closingFees = closeQty * price * feeRate;
  return { pnl: gross - closingFees - openingFees, fees: closingFees + openingFees, remainingCarry: fraction >= 1 ? 0 : entryFeeCarry * (1 - fraction) };
}
