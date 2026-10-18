"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategySimulator = void 0;
exports.strategyNamespace = strategyNamespace;
const values_1 = require("./values");
const DEFAULTS = {
    initialCapital: 100_000,
    defaultQtyType: "strategy.fixed",
    defaultQtyValue: 1,
    commissionType: "strategy.commission.percent",
    commissionValue: 0,
    slippage: 0,
    pyramiding: 1,
};
class StrategySimulator {
    constructor() {
        this.open = [];
        this.closed = [];
        this.pending = [];
        /** Stop/target instructions placed before their entry had filled. */
        this.pendingExits = new Map();
        this.realized = 0;
        this.equityPeak = 0;
        this.maxDrawdown = 0;
        this.maxDrawdownPercent = 0;
        this.barsInMarket = 0;
        this.initialCapital = DEFAULTS.initialCapital;
        this.defaultQtyType = DEFAULTS.defaultQtyType;
        this.defaultQtyValue = DEFAULTS.defaultQtyValue;
        this.commissionType = DEFAULTS.commissionType;
        this.commissionValue = DEFAULTS.commissionValue;
        this.slippage = DEFAULTS.slippage;
        this.pyramiding = DEFAULTS.pyramiding;
        this.bar = null;
        this.barIndexValue = 0;
        this.lastBarIndexValue = 0;
    }
    setBar(bar, barIndex, lastBarIndex) {
        this.bar = bar;
        this.barIndexValue = barIndex;
        this.lastBarIndexValue = lastBarIndex;
    }
    /* ---------------- lifecycle ---------------- */
    /** Fill orders queued on earlier bars. Called before the script runs. */
    beginBar() {
        const bar = this.bar;
        if (!bar)
            return;
        const queued = this.pending;
        this.pending = [];
        for (const order of queued) {
            if (order.kind === "entry") {
                this.tryFillEntry(order, bar);
            }
            else {
                this.closeById(order.id, bar.open, "signal");
            }
        }
    }
    /** Check stop/target levels against the finished bar. */
    endBar() {
        const bar = this.bar;
        if (!bar)
            return;
        for (const trade of [...this.open]) {
            const stopHit = trade.stop !== null &&
                (trade.direction === "long" ? bar.low <= trade.stop : bar.high >= trade.stop);
            const targetHit = trade.target !== null &&
                (trade.direction === "long" ? bar.high >= trade.target : bar.low <= trade.target);
            if (stopHit) {
                // Gap handling: a bar that opens beyond the stop fills at the open.
                const price = trade.direction === "long"
                    ? Math.min(trade.stop, bar.open)
                    : Math.max(trade.stop, bar.open);
                this.closeTrade(trade, price, "stop", bar.time);
            }
            else if (targetHit) {
                const price = trade.direction === "long"
                    ? Math.max(trade.target, bar.open)
                    : Math.min(trade.target, bar.open);
                this.closeTrade(trade, price, "target", bar.time);
            }
        }
        if (this.open.length)
            this.barsInMarket += 1;
    }
    /** Close everything still open at the end of the data (Pine's behaviour). */
    finish() {
        const bar = this.bar;
        if (!bar)
            return;
        for (const trade of [...this.open]) {
            this.closeTrade(trade, bar.close, "end of data", bar.time);
        }
    }
    /* ---------------- orders ---------------- */
    tryFillEntry(order, bar) {
        let price = null;
        if (order.limit !== null) {
            const marketable = order.direction === "long"
                ? bar.open <= order.limit
                : bar.open >= order.limit;
            if (marketable)
                price = order.limit;
            else {
                const touched = order.direction === "long" ? bar.low <= order.limit : bar.high >= order.limit;
                if (touched)
                    price = order.limit;
                else {
                    // Not filled yet — keep the order alive for later bars.
                    this.pending.push(order);
                    return;
                }
            }
        }
        else if (order.stop !== null) {
            const triggered = order.direction === "long" ? bar.high >= order.stop : bar.low <= order.stop;
            if (!triggered) {
                this.pending.push(order);
                return;
            }
            price = order.direction === "long" ? Math.max(order.stop, bar.open) : Math.min(order.stop, bar.open);
        }
        else {
            price = bar.open;
        }
        if (price === null)
            return;
        this.openPosition({
            id: order.id,
            direction: order.direction,
            qty: order.qty,
            price: price + (order.direction === "long" ? this.slippage : -this.slippage),
            time: bar.time,
            barIndex: this.barIndexValue,
        });
    }
    openPosition(params) {
        // Reversing: Pine closes the opposite position before opening the new one.
        const opposite = this.open.filter((trade) => trade.direction !== params.direction);
        for (const trade of opposite) {
            this.closeTrade(trade, params.price, "signal", params.time);
        }
        const sameSide = this.open.filter((trade) => trade.direction === params.direction);
        if (sameSide.length >= Math.max(1, this.pyramiding))
            return;
        // An exit placed on the same bar as the entry (before it filled) is
        // applied as soon as the position opens.
        const pending = this.pendingExits.get(params.id) ?? this.pendingExits.get("*");
        if (pending) {
            this.pendingExits.delete(params.id);
            this.pendingExits.delete("*");
        }
        const commission = this.commissionFor(params.qty, params.price);
        this.open.push({
            id: params.id,
            direction: params.direction,
            qty: params.qty,
            entryPrice: params.price,
            entryTime: params.time,
            entryBarIndex: params.barIndex,
            stop: pending?.stop ?? null,
            target: pending?.target ?? null,
            commission,
        });
    }
    commissionFor(qty, price) {
        if (!this.commissionValue)
            return 0;
        const notional = Math.abs(qty) * price;
        if (this.commissionType === "strategy.commission.cash_per_order") {
            return this.commissionValue * 2;
        }
        if (this.commissionType === "strategy.commission.cash_per_contract") {
            return this.commissionValue * Math.abs(qty) * 2;
        }
        return (notional * this.commissionValue) / 100;
    }
    closeTrade(trade, price, reason, time) {
        const index = this.open.indexOf(trade);
        if (index === -1)
            return;
        this.open.splice(index, 1);
        const exitCommission = this.commissionFor(trade.qty, price);
        const gross = trade.direction === "long"
            ? (price - trade.entryPrice) * trade.qty
            : (trade.entryPrice - price) * trade.qty;
        const commission = trade.commission + exitCommission;
        const net = gross - commission;
        this.realized += net;
        this.closed.push({
            id: trade.id,
            direction: trade.direction,
            qty: trade.qty,
            entryPrice: trade.entryPrice,
            entryTime: trade.entryTime,
            entryBarIndex: trade.entryBarIndex,
            exitPrice: price,
            exitTime: time,
            exitBarIndex: this.barIndexValue,
            exitReason: reason,
            grossProfit: gross,
            commission,
            netProfit: net,
            cumulativeProfit: this.realized,
        });
        this.updateDrawdown();
    }
    closeById(id, price, reason) {
        const trade = this.open.find((candidate) => candidate.id === id);
        if (!trade)
            return;
        this.closeTrade(trade, price, reason, this.bar?.time ?? 0);
    }
    updateDrawdown() {
        const equity = this.equity;
        if (equity > this.equityPeak)
            this.equityPeak = equity;
        const drawdown = this.equityPeak - equity;
        if (drawdown > this.maxDrawdown) {
            this.maxDrawdown = drawdown;
            this.maxDrawdownPercent = this.equityPeak > 0 ? (drawdown / this.equityPeak) * 100 : 0;
        }
    }
    /* ---------------- accessors used by strategy.* ---------------- */
    get equity() {
        const openPnl = this.open.reduce((total, trade) => {
            const price = this.bar?.close ?? trade.entryPrice;
            const pnl = trade.direction === "long"
                ? (price - trade.entryPrice) * trade.qty
                : (trade.entryPrice - price) * trade.qty;
            return total + pnl;
        }, 0);
        return this.initialCapital + this.realized + openPnl;
    }
    get openTrades() {
        return this.open;
    }
    get closedTrades() {
        return this.closed;
    }
    get positionSize() {
        return this.open.reduce((total, trade) => total + (trade.direction === "long" ? trade.qty : -trade.qty), 0);
    }
    get positionAvgPrice() {
        if (!this.open.length)
            return null;
        const qty = this.open.reduce((total, trade) => total + trade.qty, 0);
        if (!qty)
            return null;
        return this.open.reduce((total, trade) => total + trade.entryPrice * trade.qty, 0) / qty;
    }
    get netProfit() {
        return this.realized;
    }
    get grossProfit() {
        return this.closed.filter((trade) => trade.netProfit > 0).reduce((total, trade) => total + trade.netProfit, 0);
    }
    get grossLoss() {
        return Math.abs(this.closed.filter((trade) => trade.netProfit < 0).reduce((total, trade) => total + trade.netProfit, 0));
    }
    stats() {
        const wins = this.closed.filter((trade) => trade.netProfit > 0);
        const losses = this.closed.filter((trade) => trade.netProfit < 0);
        const total = this.closed.length;
        const averageTrade = total ? this.netProfit / total : 0;
        return {
            initialCapital: this.initialCapital,
            equity: this.equity,
            netProfit: this.netProfit,
            grossProfit: this.grossProfit,
            grossLoss: this.grossLoss,
            winRate: total ? (wins.length / total) * 100 : 0,
            profitFactor: this.grossLoss > 0 ? this.grossProfit / this.grossLoss : null,
            maxDrawdown: this.maxDrawdown,
            maxDrawdownPercent: this.maxDrawdownPercent,
            totalTrades: total,
            openTrades: this.open.length,
            largestWin: wins.length ? Math.max(...wins.map((trade) => trade.netProfit)) : 0,
            largestLoss: losses.length ? Math.min(...losses.map((trade) => trade.netProfit)) : 0,
            averageTrade,
            barsInMarket: this.barsInMarket,
        };
    }
    /* ---------------- Pine-facing calls ---------------- */
    entry(id, direction, qty, limit, stop, comment, alertMessage) {
        const bar = this.bar;
        if (!bar)
            return;
        const resolvedQty = qty ?? this.defaultQty(bar);
        if (resolvedQty <= 0)
            return;
        this.pending.push({
            kind: "entry",
            id,
            direction,
            qty: Math.abs(resolvedQty),
            limit,
            stop,
            comment,
            alertMessage,
            createdBarIndex: this.barIndexValue,
        });
    }
    defaultQty(bar) {
        if (this.defaultQtyType === "strategy.percent_of_equity") {
            return (this.equity * this.defaultQtyValue) / 100 / Math.max(bar.close, 1e-9);
        }
        if (this.defaultQtyType === "strategy.cash") {
            return this.defaultQtyValue / Math.max(bar.close, 1e-9);
        }
        return this.defaultQtyValue;
    }
    exit(id, fromEntry, qty, limit, stop, comment, alertMessage) {
        void qty;
        void comment;
        void alertMessage;
        const targets = this.open.filter((trade) => !fromEntry || trade.id === fromEntry);
        for (const trade of targets) {
            if (limit !== null)
                trade.target = limit;
            if (stop !== null)
                trade.stop = stop;
        }
        if (!targets.length) {
            // The entry has not filled yet — remember the instruction so it is
            // applied when the position opens.
            const key = fromEntry ?? "*";
            const previous = this.pendingExits.get(key) ?? { stop: null, target: null };
            this.pendingExits.set(key, {
                stop: stop ?? previous.stop,
                target: limit ?? previous.target,
            });
        }
        void id;
    }
    close(id) {
        const bar = this.bar;
        if (!bar)
            return;
        const targets = id ? this.open.filter((trade) => trade.id === id) : [...this.open];
        for (const trade of targets) {
            this.pending.push({
                kind: "close",
                id: trade.id,
                direction: trade.direction,
                qty: trade.qty,
                limit: null,
                stop: null,
                comment: "",
                alertMessage: "",
                createdBarIndex: this.barIndexValue,
            });
        }
    }
    cancelEntry(id) {
        this.pending = this.pending.filter((order) => order.kind !== "entry" || (id !== null && order.id !== id));
    }
    cancelExit(id) {
        for (const trade of this.open) {
            if (!id || trade.id === id) {
                trade.stop = null;
                trade.target = null;
            }
        }
    }
}
exports.StrategySimulator = StrategySimulator;
/* ------------------------------------------------------------------ */
/* The strategy.* namespace                                            */
/* ------------------------------------------------------------------ */
function arg(args, named, index, name, fallback) {
    const namedValue = named.get(name);
    if (namedValue !== undefined)
        return namedValue;
    if (index < args.length)
        return args[index];
    return fallback;
}
function directionOf(value, fallback) {
    if (value === "long")
        return "long";
    if (value === "short")
        return "short";
    if (value === "auto" || value === null || value === undefined)
        return fallback;
    return fallback;
}
/** Build the `strategy` namespace bound to a simulator. */
function strategyNamespace(sim) {
    let orderCounter = 0;
    const namespace = {
        long: "long",
        short: "short",
        auto: "auto",
        direction: { long: "long", short: "short", auto: "auto" },
        percent_of_equity: "strategy.percent_of_equity",
        cash: "strategy.cash",
        fixed: "strategy.fixed",
        default_qty_type: { fixed: "strategy.fixed", cash: "strategy.cash", percent_of_equity: "strategy.percent_of_equity" },
        commission: {
            percent: "strategy.commission.percent",
            cash_per_order: "strategy.commission.cash_per_order",
            cash_per_contract: "strategy.commission.cash_per_contract",
        },
        risk: { none: "strategy.risk.none", percent_of_equity: "strategy.risk.percent_of_equity", cash_per_contract: "strategy.risk.cash_per_contract" },
    };
    const call = (name, handler) => {
        namespace[name] = (args, ctx) => handler(args, ctx.named);
    };
    /** A live, assignable namespace member (`strategy.default_qty_type = ...`). */
    const property = (get, set) => ({ __property: true, get, set });
    call("entry", (args, named) => {
        const id = String(arg(args, named, 0, "id", "entry"));
        const direction = directionOf(arg(args, named, 1, "direction", "auto"), sim.positionSize < 0 ? "short" : "long");
        const qty = (0, values_1.toNumber)(arg(args, named, 2, "qty", null));
        const limit = (0, values_1.toNumber)(arg(args, named, 3, "limit", null));
        const stop = (0, values_1.toNumber)(arg(args, named, 4, "stop", null));
        const comment = String(arg(args, named, 6, "comment", ""));
        const alertMessage = String(arg(args, named, 7, "alert_message", ""));
        sim.entry(id, direction, qty, limit, stop, comment, alertMessage);
        return null;
    });
    call("exit", (args, named) => {
        const id = String(arg(args, named, 0, "id", "exit"));
        const fromEntry = named.get("from_entry") ?? args[1] ?? null;
        const qty = (0, values_1.toNumber)(arg(args, named, 2, "qty", null));
        const limit = (0, values_1.toNumber)(arg(args, named, 3, "limit", null));
        const stop = (0, values_1.toNumber)(arg(args, named, 4, "stop", null));
        const comment = String(arg(args, named, 6, "comment", ""));
        const alertMessage = String(arg(args, named, 7, "alert_message", ""));
        sim.exit(id, fromEntry === null ? null : String(fromEntry), qty, limit, stop, comment, alertMessage);
        return null;
    });
    call("close", (args, named) => {
        const id = named.get("id") ?? args[0] ?? null;
        sim.close(id === null ? null : String(id));
        return null;
    });
    call("close_all", () => {
        sim.close(null);
        return null;
    });
    call("cancel_entry", (args, named) => {
        const id = named.get("id") ?? args[0] ?? null;
        sim.cancelEntry(id === null ? null : String(id));
        return null;
    });
    call("cancel_exit", (args, named) => {
        const id = named.get("id") ?? args[0] ?? null;
        sim.cancelExit(id === null ? null : String(id));
        return null;
    });
    call("order", (args, named) => {
        // A generic order: direction + qty + optional limit/stop.
        const direction = directionOf(arg(args, named, 0, "direction", "auto"), sim.positionSize < 0 ? "short" : "long");
        const qty = (0, values_1.toNumber)(arg(args, named, 1, "qty", null));
        const limit = (0, values_1.toNumber)(arg(args, named, 2, "limit", null));
        const stop = (0, values_1.toNumber)(arg(args, named, 3, "stop", null));
        orderCounter += 1;
        const id = String(arg(args, named, 6, "id", `order_${orderCounter}`));
        sim.entry(id, direction, qty, limit, stop, "", "");
        return null;
    });
    /* ---- live read-only values ---- */
    namespace["position_size"] = property(() => sim.positionSize, () => undefined);
    namespace["position_avg_price"] = property(() => sim.positionAvgPrice, () => undefined);
    namespace["netprofit"] = property(() => sim.netProfit, () => undefined);
    namespace["grossprofit"] = property(() => sim.grossProfit, () => undefined);
    namespace["grossloss"] = property(() => sim.grossLoss, () => undefined);
    namespace["equity"] = property(() => sim.equity, () => undefined);
    namespace["initial_capital"] = property(() => sim.initialCapital, (value) => {
        const parsed = (0, values_1.toNumber)(value);
        if (parsed !== null)
            sim.initialCapital = parsed;
    });
    namespace["wintrades"] = property(() => sim.closedTrades.filter((trade) => trade.netProfit > 0).length, () => undefined);
    namespace["losstrades"] = property(() => sim.closedTrades.filter((trade) => trade.netProfit < 0).length, () => undefined);
    namespace["even_trades"] = property(() => sim.closedTrades.filter((trade) => trade.netProfit === 0).length, () => undefined);
    namespace["max_drawdown"] = property(() => sim.stats().maxDrawdown, () => undefined);
    namespace["max_runup"] = property(() => 0, () => undefined);
    namespace["margin_long"] = property(() => 0, () => undefined);
    namespace["margin_short"] = property(() => 0, () => undefined);
    namespace["risk_free_rate"] = property(() => 0, () => undefined);
    namespace["max_contracts_to_enter"] = property(() => null, () => undefined);
    namespace["process_orders_on_close"] = property(() => false, () => undefined);
    namespace["calc_on_order_fills"] = property(() => false, () => undefined);
    namespace["calc_on_every_tick"] = property(() => false, () => undefined);
    namespace["use_bar_magnifier"] = property(() => false, () => undefined);
    namespace["risk"] = property(() => null, () => undefined);
    /* ---- count-with-methods values ---- */
    namespace["opentrades"] = {
        __callable: true,
        value: sim.openTrades.length,
        methods: {
            entry_price: (index) => sim.openTrades[Math.floor(Number(index) || 0)]?.entryPrice ?? null,
            size: (index) => sim.openTrades[Math.floor(Number(index) || 0)]?.qty ?? null,
            profit: (index) => {
                const trade = sim.openTrades[Math.floor(Number(index) || 0)];
                if (!trade)
                    return null;
                const price = trade.entryPrice;
                return trade.direction === "long" ? 0 : 0 * price;
            },
        },
    };
    namespace["closedtrades"] = {
        __callable: true,
        value: sim.closedTrades.length,
        methods: {
            profit: (index) => sim.closedTrades[Math.floor(Number(index) || 0)]?.netProfit ?? null,
            grossprofit: (index) => sim.closedTrades[Math.floor(Number(index) || 0)]?.grossProfit ?? null,
            entry_price: (index) => sim.closedTrades[Math.floor(Number(index) || 0)]?.entryPrice ?? null,
            exit_price: (index) => sim.closedTrades[Math.floor(Number(index) || 0)]?.exitPrice ?? null,
            size: (index) => sim.closedTrades[Math.floor(Number(index) || 0)]?.qty ?? null,
            bars_in_trade: (index) => {
                const trade = sim.closedTrades[Math.floor(Number(index) || 0)];
                if (!trade || trade.exitTime === null)
                    return null;
                return Math.round((trade.exitTime - trade.entryTime) / 60);
            },
        },
    };
    /* ---- assignable settings ---- */
    namespace["default_qty_type"] = property(() => sim.defaultQtyType, (value) => {
        if (typeof value === "string")
            sim.defaultQtyType = value;
    });
    namespace["default_qty_value"] = property(() => sim.defaultQtyValue, (value) => {
        const parsed = (0, values_1.toNumber)(value);
        if (parsed !== null)
            sim.defaultQtyValue = parsed;
    });
    namespace["commission_type"] = property(() => sim.commissionType, (value) => {
        if (typeof value === "string")
            sim.commissionType = value;
    });
    namespace["commission_value"] = property(() => sim.commissionValue, (value) => {
        const parsed = (0, values_1.toNumber)(value);
        if (parsed !== null)
            sim.commissionValue = parsed;
    });
    namespace["slippage"] = property(() => sim.slippage, (value) => {
        const parsed = (0, values_1.toNumber)(value);
        if (parsed !== null)
            sim.slippage = parsed;
    });
    namespace["pyramiding"] = property(() => sim.pyramiding, (value) => {
        const parsed = (0, values_1.toNumber)(value);
        if (parsed !== null)
            sim.pyramiding = Math.floor(parsed);
    });
    return namespace;
}
