/**
 * Plain-language glossary.
 *
 * Every term here is jargon this workspace actually shows on screen. The point
 * is that a user should never have to leave the app to find out what "R:R" or
 * "expectancy" means — and never be handed a definition that oversells.
 */
export interface GlossaryEntry {
  term: string;
  plain: string;
  example?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  equity: {
    term: "Account equity",
    plain: "What the account is worth right now: starting balance + closed profit and loss + open profit and loss.",
  },
  availableMargin: {
    term: "Available margin",
    plain: "Equity that is not currently locked by open positions. This is what a new order can use.",
  },
  marginUsedPct: {
    term: "Margin used",
    plain: "Share of equity currently tied up in open positions. Higher means less room for error and for new trades.",
    example: "Above roughly 70% a single adverse move can force a position closed.",
  },
  todayPnl: {
    term: "Today P&L",
    plain: "Profit and loss from trades closed since 00:00 UTC today. Open positions are not counted here.",
  },
  openPnl: {
    term: "Open P&L",
    plain: "Unrealised profit and loss on positions still open, marked to the latest price. It can still change.",
  },
  rr: {
    term: "Risk-to-reward (R:R)",
    plain: "How much the target aims to make for each unit risked to the stop.",
    example: "1:2 means the target is twice as far away as the stop.",
  },
  rMultiple: {
    term: "R multiple",
    plain: "Result measured in units of risk. +2R means the trade made twice what it risked; -1R means it lost the full risk.",
  },
  expectancy: {
    term: "Expectancy",
    plain: "Average result per trade given past win rate and average win/loss. A description of the sample, not a promise.",
  },
  profitFactor: {
    term: "Profit factor",
    plain: "Total profit from winners divided by total loss from losers. Above 1 means winners outweigh losers in this sample.",
  },
  returnVol: {
    term: "Return / volatility (per trade)",
    plain: "Average trade return divided by how much trade returns varied. Descriptive only — not annualised, not a Sharpe ratio.",
  },
  dsr: {
    term: "Deflated Sharpe Ratio",
    plain: "A Sharpe-ratio adjustment for testing many strategy variants. It needs a trial count and higher moments, so this build reports it as unavailable rather than inventing a number.",
  },
  mfe: {
    term: "Maximum favourable excursion (MFE)",
    plain: "How far a signal moved in your favour before it resolved, measured in R. Shows whether targets were realistic.",
  },
  mae: {
    term: "Maximum adverse excursion (MAE)",
    plain: "How far a signal moved against you before it resolved, measured in R. Shows whether stops were too tight.",
  },
  heikinAshi: {
    term: "Heikin-Ashi",
    plain: "Smoothed candles that make trends easier to see. Their prices never traded, so this workspace uses them to read direction only — never as entry or stop prices.",
  },
  donchian: {
    term: "Donchian channel",
    plain: "Highest high and lowest low over a lookback window. Each window is measured from bars before the current one, so a candle cannot break its own high or low.",
  },
  chandelier: {
    term: "Chandelier Exit",
    plain: "A trailing stop placed a multiple of volatility (ATR) below the recent high in an uptrend, and above the recent low in a downtrend.",
  },
  atr: {
    term: "ATR (Average True Range)",
    plain: "Average size of recent candles, used to size stops to current volatility instead of a fixed distance.",
  },
  markPrice: {
    term: "Mark price",
    plain: "The exchange's fair price used to value positions and trigger liquidations. It can differ slightly from the last traded price.",
  },
  fundingRate: {
    term: "Funding rate",
    plain: "A periodic payment between long and short futures holders to keep the contract near spot. It is a real cost to hold a position.",
  },
  openInterest: {
    term: "Open interest",
    plain: "Number of contracts still open. Rising open interest with rising price suggests fresh positions rather than short covering.",
  },
  dataSource: {
    term: "Data source",
    plain: "Demo uses a deterministic simulator with clearly labelled prices. CoinDCX reads the venue's public market data. There is no silent fallback between them.",
  },
  executionMode: {
    term: "Execution mode",
    plain: "Read only analyses only. Paper simulates orders without touching the venue. Live routes real orders and stays locked until deliberately armed.",
  },
  paperMode: {
    term: "Paper trading",
    plain: "Orders and positions are simulated against the current market price. Nothing is sent to the exchange and results are not real fills.",
  },
  colorblind: {
    term: "Colour-blind friendly palette",
    plain: "Switches gain/loss from green/red to blue/orange, which stays distinguishable with colour-vision deficiency. Direction arrows are shown either way.",
  },
  readiness: {
    term: "Decision readiness",
    plain: "A checklist of what is actually true right now: is data flowing, is analysis fresh, is there a candidate setup, and can orders be placed.",
  },
  inr: {
    term: "INR valuation",
    plain: "The US-dollar balance converted at the rate in your settings for reference. It is an estimate, not an exchange conversion.",
  },
  slippage: {
    term: "Slippage and fees",
    plain: "Backtests charge a fee and a slippage assumption per side. Funding, partial fills and latency are not modelled, so treat results as approximate.",
  },
};
