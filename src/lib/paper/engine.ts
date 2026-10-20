/**
 * Paper trading engine.
 *
 * Simulates market/limit/stop orders and positions against real-time market
 * prices without touching the exchange. Paper records are stored in their own
 * tables and journal entries are always tagged mode="paper" — they are never
 * mixed with live exchange records.
 */
import { allocatePaperClose } from "./accounting";
import { normalisePaperAccounting, recordPaperClose, snapshotPaperContext } from "../journal/service";
import { getRepo } from "@/lib/repo";
import { PAPER_FEE_RATE } from "../flags";
import { evaluateOrderRisk, normalizeRiskLimits } from "../risk";
import { getTickers } from "../market/service";
import { getSettings, logAudit } from "../settings";

export interface PlaceOrderInput {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_market" | "stop_limit";
  qty: number;
  price?: number | null;
  stopPrice?: number | null;
  reduceOnly?: boolean;
  /** Idempotency key; a retried submission resolves to the same order. */
  clientOrderId?: string;
}

export interface PaperEvent {
  kind: "order_filled" | "order_placed" | "position_opened" | "position_closed" | "tp_hit" | "sl_hit" | "blocked";
  message: string;
}

const EPS = 1e-9;

export async function placePaperOrder(
  input: PlaceOrderInput,
  markPrice: number,
  limits: {
    maxOrderValue: number;
    maxOpenPositions: number;
    maxDailyLoss: number;
    /** Optional: the leverage check activates only when both are supplied. */
    maxLeverage?: number;
    equity?: number;
  }
): Promise<
  | { ok: true; orderId: string; status: string; deduplicated?: boolean }
  | { ok: false; error: string }
> {
  const { symbol, side, type, qty } = input;
  if (!symbol || !["buy", "sell"].includes(side) || qty <= 0) {
    return { ok: false, error: "Invalid order parameters" };
  }
  if (!input.clientOrderId) {
    return { ok: false, error: "client_order_id is required" };
  }
  if (["limit", "stop_market", "stop_limit"].includes(type) && !(input.price ?? input.stopPrice)) {
    return { ok: false, error: "Limit/stop orders require a price" };
  }

  // ---- risk checks -------------------------------------------------------
  // Same evaluator as the live path (lib/risk.ts) so both are governed by one
  // set of rules and neither can drift from the other.
  const refPrice = type === "market" ? markPrice : (input.price ?? input.stopPrice ?? markPrice);
  const repo = await getRepo();
  // Resolve a retry BEFORE any risk check or fill: the original order may
  // already have moved positions, so re-evaluating its risk would be wrong.
  const existing = await repo.findPaperOrderByClientId(input.clientOrderId);
  if (existing) {
    return {
      ok: true,
      orderId: existing.id,
      status: existing.status,
      deduplicated: true,
    };
  }
  const positions = await repo.listPaperPositions();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayPnl = await repo.sumJournalPnl({ mode: "paper", closedSince: dayStart });

  const settings = await getSettings();
  // Paper is governed by the SAME bounded limits as live. Passing raw stored
  // values let a nonsense setting (1e12) disable every cap.
  const safeLimits = normalizeRiskLimits(limits);
  const realized = await repo.sumJournalPnl({ mode: "paper" });
  const marks = new Map((await getTickers(positions.map(p => p.symbol))).map(t => [t.symbol, t.price]));
  const openPnl = positions.reduce((sum, p) => sum + ((marks.get(p.symbol) ?? p.entry) - p.entry) * p.qty * (p.side === "long" ? 1 : -1), 0);
  const verdict = evaluateOrderRisk(
    { symbol, qty, price: refPrice, reduceOnly: Boolean(input.reduceOnly) },
    {
      limits: {
        maxDailyLoss: safeLimits.maxDailyLoss,
        maxOrderValue: safeLimits.maxOrderValue,
        maxLeverage: limits.maxLeverage === undefined ? 0 : safeLimits.maxLeverage,
        maxOpenPositions: safeLimits.maxOpenPositions,
      },
      openSymbols: positions.map((p) => p.symbol),
      currentNotional: positions.reduce((a, p) => a + Math.abs(p.qty) * (marks.get(p.symbol) ?? p.entry), 0),
      equity: limits.equity ?? settings.startingBalance + realized + openPnl,
      // Paper P&L is fully local, so this is always known — never null here.
      dailyRealizedPnl: todayPnl,
    }
  );
  if (!verdict.allowed) {
    await logAudit("risk_block_triggered", {
      scope: "paper",
      symbol,
      side,
      code: verdict.code,
      reason: verdict.reason,
    });
    return { ok: false, error: `Blocked by risk limit: ${verdict.reason}` };
  }

  // ---- create ------------------------------------------------------------
  const inserted = await repo.insertPaperOrder({
    symbol, side, type, qty,
    price: input.price ?? null,
    stopPrice: input.stopPrice ?? null,
    reduceOnly: input.reduceOnly ?? false,
    status: "open",
    clientOrderId: input.clientOrderId,
  });
  if (!inserted.created) {
    // Lost a race with an identical submission: never fill twice.
    return {
      ok: true,
      orderId: inserted.order.id,
      status: inserted.order.status,
      deduplicated: true,
    };
  }
  const row = inserted.order;

  if (type === "market") {
    await executeFill(row.id, markPrice);
    return { ok: true, orderId: row.id, status: "filled" };
  }
  return { ok: true, orderId: row.id, status: "open" };
}

async function executeFill(orderId: string, fillPrice: number): Promise<PaperEvent[]> {
  const events: PaperEvent[] = [];
  const repo = await getRepo();
  const order = await repo.getPaperOrder(orderId);
  if (!order || order.status !== "open") return events;
  const fees = order.qty * fillPrice * PAPER_FEE_RATE;

  const found = await repo.getPaperPositionBySymbol(order.symbol);
  const pos = found ? await normalisePaperAccounting(found) : null;
  const orderSide: "long" | "short" = order.side === "buy" ? "long" : "short";

  if (!pos) {
    if (order.reduceOnly) {
      await repo.updatePaperOrder(orderId, { status: "rejected" });
      return [{ kind: "blocked", message: `${order.symbol} reduce-only order rejected: no position` }];
    }
    const opened = await repo.insertPaperPosition({
      symbol: order.symbol,
      side: orderSide,
      qty: order.qty,
      entry: fillPrice,
      realizedPnl: -fees,
    });
    await snapshotPaperContext(opened);
    events.push({ kind: "position_opened", message: `${order.symbol} ${orderSide.toUpperCase()} ${order.qty} @ ${fillPrice.toFixed(2)} (paper)` });
  } else if (pos.side === orderSide) {
    const newQty = pos.qty + order.qty;
    const newEntry = (pos.entry * pos.qty + fillPrice * order.qty) / newQty;
    await repo.updatePaperPosition(pos.id, {
      qty: newQty, entry: newEntry, realizedPnl: pos.realizedPnl - fees,
    });
    events.push({ kind: "order_filled", message: `Added ${order.qty} ${order.symbol} ${orderSide} @ ${fillPrice.toFixed(2)} (paper)` });
  } else {
    const closeQty = Math.min(pos.qty, order.qty);
    const dir = pos.side === "long" ? 1 : -1;
    const gross = (fillPrice - pos.entry) * closeQty * dir;
    const remaining = pos.qty - closeQty;
    const allocation = allocatePaperClose(pos.qty, closeQty, pos.realizedPnl, fillPrice, PAPER_FEE_RATE, gross);
    if (remaining <= EPS) {
      const net = allocation.pnl;
      await recordPaperClose({
        mode: "paper",
        symbol: order.symbol,
        direction: pos.side,
        entry: pos.entry,
        exit: fillPrice,
        qty: pos.qty,
        fees: allocation.fees,
        pnl: net,
        strategy: "paper",
        reason: "Position closed by paper order",
        notes: "",
        emotion: "",
        tags: ["paper"],
        openedAt: pos.openedAt ?? new Date(),
        closedAt: new Date(),
        source: "paper",
      }, pos.id, order.id);
      await repo.deletePaperPosition(pos.id);
      events.push({ kind: "position_closed", message: `${order.symbol} ${pos.side.toUpperCase()} closed @ ${fillPrice.toFixed(2)} — net ${net >= 0 ? "+" : ""}$${net.toFixed(2)} (paper)` });
    } else {
      // Create journal entry for partial close
      const partialNet = allocation.pnl;
      await recordPaperClose({
        mode: "paper",
        symbol: order.symbol,
        direction: pos.side,
        entry: pos.entry,
        exit: fillPrice,
        qty: closeQty,
        fees: allocation.fees,
        pnl: partialNet,
        strategy: "paper",
        reason: "Partial position close by paper order",
        notes: `Partial close: ${closeQty} of ${pos.qty} closed, ${remaining} remaining`,
        emotion: "",
        tags: ["paper", "partial"],
        openedAt: pos.openedAt ?? new Date(),
        closedAt: new Date(),
        source: "paper",
      }, pos.id, order.id);
      await repo.updatePaperPosition(pos.id, {
        qty: remaining, realizedPnl: allocation.remainingCarry,
      });

      events.push({ kind: "order_filled", message: `Reduced ${order.symbol} by ${closeQty} @ ${fillPrice.toFixed(2)} (paper)` });
    }
    if (order.qty > closeQty + EPS && !order.reduceOnly) {
      const flipQty = order.qty - closeQty;
      const flipped = await repo.insertPaperPosition({
        symbol: order.symbol,
        side: orderSide,
        qty: flipQty,
        entry: fillPrice,
        realizedPnl: -(flipQty * fillPrice * PAPER_FEE_RATE),
      });
      await snapshotPaperContext(flipped);
      events.push({ kind: "position_opened", message: `${order.symbol} flipped to ${orderSide.toUpperCase()} ${flipQty} @ ${fillPrice.toFixed(2)} (paper)` });
    }
  }

  await repo.updatePaperOrder(orderId, { status: "filled", filledPrice: fillPrice });
  await logAudit("paper_order_filled", { orderId, symbol: order.symbol, fillPrice, qty: order.qty });
  return events;
}

/**
 * Evaluate pending orders and position TP/SL against current prices.
 * Called lazily whenever the client polls paper state — no background
 * process required. Returns events for the notification feed.
 */
export async function syncPaper(prices: Map<string, number>): Promise<PaperEvent[]> {
  const events: PaperEvent[] = [];
  const repo = await getRepo();
  const openOrders = await repo.listPaperOrders({ status: "open" });
  for (const o of openOrders) {
    const p = prices.get(o.symbol);
    if (!p) continue;
    let triggered = false;
    if (o.type === "limit") triggered = o.side === "buy" ? p <= (o.price ?? 0) : p >= (o.price ?? Infinity);
    else triggered = o.side === "sell" ? p <= (o.stopPrice ?? Infinity) : p >= (o.stopPrice ?? 0);
    if (triggered) events.push(...(await executeFill(o.id, p)));
  }

  const positions = await repo.listPaperPositions();
  for (const original of positions) {
    const pos = await normalisePaperAccounting(original);
    const p = prices.get(pos.symbol);
    if (!p) continue;
    const hitStop = pos.stop !== null && (pos.side === "long" ? p <= pos.stop : p >= pos.stop);
    const hitTarget = pos.target !== null && (pos.side === "long" ? p >= pos.target : p <= pos.target);
    if (hitStop || hitTarget) {
      const exitPrice = hitStop ? (pos.stop as number) : (pos.target as number);
      const dir = pos.side === "long" ? 1 : -1;
      const gross = (exitPrice - pos.entry) * pos.qty * dir;
      const fees = pos.qty * exitPrice * PAPER_FEE_RATE;
      const net = pos.realizedPnl + gross - fees;
      await recordPaperClose({
        mode: "paper",
        symbol: pos.symbol,
        direction: pos.side,
        entry: pos.entry,
        exit: exitPrice,
        qty: pos.qty,
        fees: fees - pos.realizedPnl,
        pnl: net,
        strategy: "paper",
        reason: hitStop ? "Stop-loss hit" : "Take-profit hit",
        notes: "",
        emotion: "",
        tags: ["paper", hitStop ? "sl" : "tp"],
        openedAt: pos.openedAt ?? new Date(),
        closedAt: new Date(),
        source: "paper",
      }, pos.id);
      await repo.deletePaperPosition(pos.id);
      events.push({
        kind: hitStop ? "sl_hit" : "tp_hit",
        message: `${pos.symbol} ${hitStop ? "STOP" : "TARGET"} hit @ ${exitPrice.toFixed(2)} — net ${net >= 0 ? "+" : ""}$${net.toFixed(2)} (paper)`,
      });
    }
  }
  return events;
}

export async function attachBrackets(
  symbol: string,
  stop: number | null,
  target: number | null
): Promise<boolean> {
  const res = await (await getRepo()).updatePaperPositionBySymbol(symbol, { stop, target });
  return res.length > 0;
}

export async function closePaperPosition(positionId: string, markPrice: number): Promise<PaperEvent[]> {
  const repo = await getRepo();
  const original = (await repo.listPaperPositions()).find((p) => p.id === positionId) ?? null;
  const pos = original ? await normalisePaperAccounting(original) : null;
  if (!pos) return [];
  const dir = pos.side === "long" ? 1 : -1;
  const gross = (markPrice - pos.entry) * pos.qty * dir;
  const fees = pos.qty * markPrice * PAPER_FEE_RATE;
  const net = pos.realizedPnl + gross - fees;
  await recordPaperClose({
    mode: "paper",
    symbol: pos.symbol,
    direction: pos.side,
    entry: pos.entry,
    exit: markPrice,
    qty: pos.qty,
    fees: fees - pos.realizedPnl,
    pnl: net,
    strategy: "paper",
    reason: "Manually closed from dashboard",
    notes: "",
    emotion: "",
    tags: ["paper", "manual-close"],
    openedAt: pos.openedAt ?? new Date(),
    closedAt: new Date(),
    source: "paper",
  }, pos.id);
  await repo.deletePaperPosition(pos.id);
  await logAudit("paper_position_closed", { positionId, symbol: pos.symbol, net });
  return [{ kind: "position_closed", message: `${pos.symbol} closed @ ${markPrice.toFixed(2)} — net ${net >= 0 ? "+" : ""}$${net.toFixed(2)} (paper)` }];
}

export async function cancelPaperOrder(orderId: string): Promise<boolean> {
  const repo = await getRepo();
  const order = await repo.getPaperOrder(orderId);
  if (!order || order.status !== "open") return false;
  await repo.updatePaperOrder(orderId, { status: "cancelled" });
  return true;
}

export async function getPaperState(prices: Map<string, number>) {
  const repo = await getRepo();
  const positions = (await repo.listPaperPositions()).map((p) => {
    const mark = prices.get(p.symbol) ?? p.entry;
    const dir = p.side === "long" ? 1 : -1;
    return { ...p, mark, upl: (mark - p.entry) * p.qty * dir, notional: mark * p.qty };
  });
  const orders = await repo.listPaperOrders();
  return { positions, orders: orders.slice(0, 120) };
}

export async function todayPaperRealized(): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return (await getRepo()).sumJournalPnl({ mode: "paper", closedSince: dayStart });
}

export async function hasAnyJournal(): Promise<boolean> {
  return (await getRepo()).hasAnyJournal();
}
