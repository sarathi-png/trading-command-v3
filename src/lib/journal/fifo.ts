import { createHash } from "node:crypto";
export interface JournalFill {
  key: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  fee: number; // USD-equivalent, converted once at import
  ts: number;
  margin: "USDT" | "INR";
  nativeFee: number;
  fxRate: number;
  orderId: string | null;
}
export interface MatchedTrade {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  exit: number;
  qty: number;
  fees: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  margin: "USDT" | "INR";
  openingFill: string;
  closingFill: string;
}
export function stableUuid(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Pure FIFO reconstruction. It is NOT exchange-booked realised P&L. */
export function matchJournalFills(fills: JournalFill[]): MatchedTrade[] {
  const groups = new Map<string, JournalFill[]>();
  for (const fill of fills) {
    if (![fill.price, fill.quantity, fill.fee, fill.ts].every(Number.isFinite) || fill.price <= 0 || fill.quantity <= 0 || fill.ts <= 0) throw Error("Invalid exchange fill");
    const groupKey = `${fill.symbol}:${fill.margin}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), fill]);
  }
  const trades: MatchedTrade[] = [];
  for (const rows of groups.values()) {
    const long: { fill: JournalFill; qty: number }[] = [], short: typeof long = [];
    for (const fill of [...rows].sort((a,b) => a.ts - b.ts || a.key.localeCompare(b.key))) {
      const opposite = fill.side === "buy" ? short : long;
      let remaining = fill.quantity;
      while (remaining > 1e-12 && opposite.length) {
        const lot = opposite[0];
        const qty = Math.min(lot.qty, remaining);
        const fees = qty * (Math.abs(fill.fee) / fill.quantity + Math.abs(lot.fill.fee) / lot.fill.quantity);
        const direction = fill.side === "buy" ? "short" : "long";
        const pnl = qty * (fill.price - lot.fill.price) * (direction === "long" ? 1 : -1) - fees;
        trades.push({ id: stableUuid(`${lot.fill.key}|${fill.key}`), symbol: fill.symbol, direction, entry: lot.fill.price, exit: fill.price, qty, fees, pnl,
          openedAt: new Date(lot.fill.ts).toISOString(), closedAt: new Date(fill.ts).toISOString(), margin: fill.margin, openingFill: lot.fill.key, closingFill: fill.key });
        lot.qty -= qty; remaining -= qty;
        if (lot.qty <= 1e-12) opposite.shift();
      }
      if (remaining > 1e-12) (fill.side === "buy" ? long : short).push({ fill, qty: remaining });
    }
  }
  return trades.sort((a,b) => b.closedAt.localeCompare(a.closedAt));
}
