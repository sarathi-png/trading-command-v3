/**
 * Cost model shared by the backtest and paper accounting.
 *
 * All rates are FRACTIONS (0.00059 = 0.059%). Defaults are placeholders taken from
 * the repo (taker 0.059%, paper 0.05%) and a conventional funding assumption; verify
 * against the current CoinDCX fee schedule and funding history before relying on them.
 */
export interface CostModel {
  takerFee: number;      // per fill, on notional
  makerFee: number;      // per fill, on notional (used only when entryMaker = true)
  slippage: number;      // adverse, per market fill (entries and exits)
  fundingPer8h: number;  // longs pay / shorts receive when positive
  barMinutes: number;    // execution timeframe in minutes
}

export const DEFAULT_COSTS: CostModel = {
  takerFee: 0.00059,
  makerFee: 0.0004,
  slippage: 0.0002,
  fundingPer8h: 0.0001,
  barMinutes: 240,
};

/** Funding paid (positive) or received (negative) by a position, in price units per unit of qty. */
export function fundingPrice(side: 1 | -1, avgPrice: number, bars: number, c: CostModel): number {
  const periods = (bars * c.barMinutes) / (8 * 60);
  return side * c.fundingPer8h * periods * avgPrice;
}

/** Fees in price units per unit of qty for one round trip. */
export function feesPrice(entryFill: number, exitFill: number, c: CostModel, entryMaker = false): number {
  const entryRate = entryMaker ? c.makerFee : c.takerFee;
  return entryRate * entryFill + c.takerFee * exitFill;
}