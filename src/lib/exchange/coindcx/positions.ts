/**
 * CoinDCX futures — positions.
 *
 *   POST /exchange/v1/derivatives/futures/positions                    list / by pair / by position id
 *   POST /exchange/v1/derivatives/futures/positions/exit               close a position at market
 *   POST /exchange/v1/derivatives/futures/positions/update_leverage    set leverage
 *   POST /exchange/v1/derivatives/futures/positions/create_tpsl        take profit / stop loss for a position
 *   POST /exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position
 *
 * Field mapping verified against the reference's response table:
 *   active_pos   signed size in base units (negative = short)
 *   avg_price    average entry price
 *   mark_price   venue mark price at last update (explicitly NOT real-time)
 *   locked_margin / locked_user_margin  margin in the settlement currency
 *   leverage, liquidation_price, take_profit_trigger, stop_loss_trigger
 *
 * Unrealised P&L is NOT a field CoinDCX returns on the position: it is
 * (mark - entry) × size, which is what the venue's own UI shows. When the
 * position has never been updated (`mark_price` null/0) we report 0 upl rather
 * than inventing a price — the caller decides whether that is good enough, and
 * the order path never relies on it for sizing.
 */
import type { ExchangePosition } from "../types";
import { toExchangeSymbol, toInternalSymbol } from "../symbols";
import { expectArray, num } from "./parse";
import type { CoinDcxClient } from "./client";

const MARGIN = ["USDT"] as const;

interface PositionRow {
  id?: string;
  pair?: string;
  active_pos?: number | string;
  avg_price?: number | string;
  mark_price?: number | string | null;
  leverage?: number | string | null;
  liquidation_price?: number | string | null;
  locked_margin?: number | string;
  locked_user_margin?: number | string;
  margin_currency_short_name?: string;
  updated_at?: number;
}

export function normalisePosition(row: PositionRow): ExchangePosition {
  const exchangeSymbol = String(row.pair ?? "").toUpperCase();
  const size = num(row.active_pos);
  const entry = num(row.avg_price);
  const mark = num(row.mark_price, entry);
  const upl = size === 0 ? 0 : (mark - entry) * size;
  return {
    symbol: toInternalSymbol(exchangeSymbol),
    exchangeSymbol,
    side: size < 0 ? "short" : "long",
    qty: Math.abs(size),
    entry,
    mark,
    upl,
    leverage: row.leverage === null || row.leverage === undefined ? null : num(row.leverage),
    liquidationPrice: row.liquidation_price === null || row.liquidation_price === undefined ? null : num(row.liquidation_price),
    margin: row.locked_margin === undefined ? null : num(row.locked_margin),
    exchangePositionId: row.id ? String(row.id) : null,
  };
}

/**
 * All non-zero positions for the account.
 *
 * Delta made the caller fan out per underlying; CoinDCX returns every position
 * in one page, so the watchlist fan-out disappears. Zero-size rows (CoinDCX
 * returns a row per pair you have ever opened) are filtered out.
 */
export async function positions(client: CoinDcxClient, options: { page?: number; size?: number } = {}): Promise<ExchangePosition[]> {
  const rows = await client.read<PositionRow[]>("/exchange/v1/derivatives/futures/positions", {
    page: options.page ?? 1,
    size: options.size ?? 100,
    margin_currency_short_name: [...MARGIN],
  });
  return expectArray<PositionRow>(rows, "/exchange/v1/derivatives/futures/positions")
    .map(normalisePosition)
    .filter((position) => position.qty > 0);
}

/** One pair's position (or null when flat). Used before exits and by risk. */
export async function positionFor(client: CoinDcxClient, symbol: string): Promise<ExchangePosition | null> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const rows = await client.read<PositionRow[]>("/exchange/v1/derivatives/futures/positions", {
    page: 1,
    size: 10,
    pairs: pair,
    margin_currency_short_name: [...MARGIN],
  });
  const list = expectArray<PositionRow>(rows, "/exchange/v1/derivatives/futures/positions");
  if (list.length === 0) return null;
  const normalised = normalisePosition(list[0]!);
  return normalised.qty > 0 ? normalised : null;
}

/** Set leverage for a pair. Must be done before ordering — see orders.ts. */
export async function updateLeverage(client: CoinDcxClient, symbol: string, leverage: number): Promise<void> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  await client.mutate("/exchange/v1/derivatives/futures/positions/update_leverage", {
    leverage: String(leverage),
    pair,
    margin_currency_short_name: [...MARGIN],
  });
}

/**
 * Close a position at market ("quick exit"). CoinDCX takes the position id;
 * we resolve it from the pair so callers can stay symbol-based.
 *
 * This is a MUTATION: it is attempted once and never auto-retried.
 */
export async function exitPosition(client: CoinDcxClient, symbol: string): Promise<{ raw: unknown; positionId: string | null }> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const existing = await positionFor(client, symbol);
  const payload: Record<string, unknown> = {
    pair,
    margin_currency_short_name: [...MARGIN],
    ...(existing?.exchangePositionId ? { id: existing.exchangePositionId } : {}),
  };
  const raw = await client.mutate("/exchange/v1/derivatives/futures/positions/exit", payload);
  return { raw, positionId: existing?.exchangePositionId ?? null };
}

/**
 * Attach take-profit / stop-loss to a position.
 *
 * The reference is explicit that only `take_profit_market` and `stop_market`
 * are supported today, and that both stop prices are mandatory.
 */
export async function createTpSl(
  client: CoinDcxClient,
  input: { symbol: string; takeProfitPrice?: number; stopLossPrice?: number }
): Promise<unknown> {
  const pair = toExchangeSymbol(input.symbol, "coindcx");
  const position = await positionFor(client, input.symbol);
  if (!position?.exchangePositionId) {
    throw new Error(`No open CoinDCX position on ${pair} to attach TP/SL to.`);
  }
  if (input.takeProfitPrice === undefined && input.stopLossPrice === undefined) {
    throw new Error("createTpSl needs at least one of takeProfitPrice / stopLossPrice.");
  }
  const payload: Record<string, unknown> = { id: position.exchangePositionId };
  if (input.takeProfitPrice !== undefined) {
    payload.take_profit = {
      stop_price: String(input.takeProfitPrice),
      order_type: "take_profit_market",
    };
  }
  if (input.stopLossPrice !== undefined) {
    payload.stop_loss = {
      stop_price: String(input.stopLossPrice),
      order_type: "stop_market",
    };
  }
  return client.mutate("/exchange/v1/derivatives/futures/positions/create_tpsl", payload);
}

/** Cancel every open order belonging to a position. */
export async function cancelPositionOrders(client: CoinDcxClient, symbol: string): Promise<unknown> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const position = await positionFor(client, symbol);
  if (!position?.exchangePositionId) {
    throw new Error(`No open CoinDCX position on ${pair} whose orders could be cancelled.`);
  }
  return client.mutate("/exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position", {
    id: position.exchangePositionId,
  });
}
