"use client";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Btn, Chip, EmptyState, Input, KV, Modal, Panel, Select, Skeleton, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtPrice, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useMarket, useApp } from "@/stores";
import type { PaperOrder, PaperPosition } from "@/lib/types";

type OrderType = "market" | "limit" | "stop_market" | "stop_limit";

export default function OrdersPage() {
  const { settings, activeSymbol, notify } = useApp();
  const ticker = useMarket((s) => s.tickers[activeSymbol]);
  const { data, refresh } = usePoll(
    () => api.get<{ orders: PaperOrder[]; positions: (PaperPosition & { upl: number })[] }>("/api/paper"),
    5000
  );

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<OrderType>("market");
  const [qty, setQty] = useState("0.01");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [liveModal, setLiveModal] = useState(false);

  const readOnly = settings.mode === "read_only";
  const liveMode = settings.mode === "live";
  const refPrice = type === "market" ? ticker?.price ?? 0 : parseFloat(price) || parseFloat(stopPrice) || 0;
  const notional = (parseFloat(qty) || 0) * refPrice;

  const submitPaper = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        action: "place", symbol: activeSymbol, side, type, qty: parseFloat(qty) || 0,
        reduceOnly,
      };
      if (type === "limit") body.price = parseFloat(price) || null;
      if (type === "stop_market" || type === "stop_limit") {
        body.stopPrice = parseFloat(stopPrice) || null;
        if (type === "stop_limit") body.price = parseFloat(price) || null;
      }
      if (stop) body.stop = parseFloat(stop);
      if (target) body.target = parseFloat(target);
      await api.post("/api/paper", body);
      notify({ title: "Paper order accepted", body: `${side.toUpperCase()} ${qty} ${activeSymbol} (${type})`, tone: "success" });
      refresh();
    } catch (e) {
      notify({ title: "Order rejected", body: e instanceof Error ? e.message : "Unknown error", tone: "danger" });
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async () => {
    if (readOnly) return;
    if (liveMode) { setLiveModal(true); return; }
    await submitPaper();
  };

  const submitLive = async () => {
    setLiveModal(false);
    try {
      const res = await api.post<{ ok: boolean }>("/api/orders", {
        symbol: activeSymbol, side, size: parseFloat(qty) || 0,
        type: type === "limit" ? "limit_order" : "market_order",
        limit_price: type === "limit" ? parseFloat(price) : undefined,
      });
      notify({ title: "Live order placed", body: `${activeSymbol} ${side}`, tone: "success" });
      void res;
    } catch (e) {
      notify({ title: "Live order blocked", body: e instanceof Error ? e.message : "Unknown error", tone: "danger" });
    }
  };

  const orders = data?.orders ?? [];
  const openOrders = orders.filter((o) => o.status === "open");
  const history = orders.filter((o) => o.status !== "open").slice(0, 40);

  return (
    <div className="p-3 grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-3 max-w-[1500px] mx-auto">
      {/* order ticket */}
      <Panel title="ORDER TICKET" badge={
        settings.mode === "paper" ? <Chip tone="warn">PAPER</Chip>
        : settings.mode === "live" ? <Chip tone="danger">LIVE</Chip>
        : <Chip>READ ONLY</Chip>
      }>
        {readOnly ? (
          <div className="p-4">
            <div className="flex items-start gap-2 text-[11px] text-mut leading-relaxed">
              <ShieldAlert size={16} className="text-warn flex-none mt-0.5" />
              <p>
                Execution is <span className="text-ink">disabled</span>. The ticket unlocks in{" "}
                <span className="text-warn">PAPER MODE</span> (simulated fills) — switch modes in
                Settings → Execution. Live trading additionally requires server configuration and the master switch.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setSide("buy")}
                className={cx("h-8 rounded text-[11px] font-semibold border", side === "buy" ? "bg-up/15 text-up border-up/40" : "text-dim border-edge hover:text-mut")}>
                BUY / LONG
              </button>
              <button onClick={() => setSide("sell")}
                className={cx("h-8 rounded text-[11px] font-semibold border", side === "sell" ? "bg-dn/15 text-dn border-dn/40" : "text-dim border-edge hover:text-mut")}>
                SELL / SHORT
              </button>
            </div>
            <label className="block space-y-1"><span className="microlabel">ORDER TYPE</span>
              <Select value={type} onChange={(e) => setType(e.target.value as OrderType)} className="w-full">
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop_market">Stop Market</option>
                <option value="stop_limit">Stop Limit</option>
              </Select>
            </label>
            <label className="block space-y-1"><span className="microlabel">QUANTITY ({activeSymbol})</span>
              <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            {(type === "limit" || type === "stop_limit") && (
              <label className="block space-y-1"><span className="microlabel">LIMIT PRICE</span>
                <Input inputMode="decimal" placeholder={ticker ? String(ticker.price) : ""} value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
            )}
            {(type === "stop_market" || type === "stop_limit") && (
              <label className="block space-y-1"><span className="microlabel">STOP TRIGGER PRICE</span>
                <Input inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
              </label>
            )}
            {settings.mode === "paper" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1"><span className="microlabel">STOP LOSS (OPT)</span>
                  <Input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
                </label>
                <label className="block space-y-1"><span className="microlabel">TAKE PROFIT (OPT)</span>
                  <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
                </label>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-dim">Reduce only</span>
              <Toggle checked={reduceOnly} onChange={setReduceOnly} label="Reduce only" />
            </div>
            <div className="border-t border-edge pt-2">
              <KV k="REF PRICE" v={refPrice ? fmtPrice(refPrice) : "—"} />
              <KV k="NOTIONAL" v={notional > 0 ? fmtUsd(notional) : "—"} />
              <KV k="EST FEES (0.05%)" v={notional > 0 ? fmtUsd(notional * 0.0005) : "—"} />
              <KV k="LIMIT MAX ORDER" v={fmtUsd(settings.riskLimits.maxOrderValue)} />
            </div>
            {notional > settings.riskLimits.maxOrderValue && (
              <p className="text-[10px] text-dn">Exceeds max order value — this order will be blocked.</p>
            )}
            <Btn
              variant={side === "buy" ? "up" : "danger"}
              size="md"
              className="w-full"
              disabled={submitting || !(parseFloat(qty) > 0)}
              onClick={() => void onSubmit()}
            >
              {submitting ? "SUBMITTING…" : `${side === "buy" ? "BUY" : "SELL"} ${qty || "0"} ${activeSymbol}${settings.mode === "paper" ? " (PAPER)" : " (LIVE)"}`}
            </Btn>
            <p className="text-[9px] text-dim leading-snug">
              {settings.mode === "paper"
                ? "Paper orders simulate fills against current market prices. They never reach the exchange."
                : "Live orders require LIVE_EXECUTION_ENABLED, LIVE mode and the master switch."}
            </p>
          </div>
        )}
      </Panel>

      {/* open orders + history */}
      <div className="space-y-3 min-w-0">
        <Panel title="OPEN ORDERS" badge={<span className="text-[9px] num text-dim">{openOrders.length}</span>}>
          {settings.mode === "read_only" ? (
            <EmptyState title="No order entry in read-only mode" hint="Switch to PAPER mode to place simulated orders." />
          ) : !data ? (
            <div className="p-3 space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : openOrders.length === 0 ? (
            <EmptyState title="No open orders" hint="Limit and stop orders waiting to trigger appear here." />
          ) : (
            <OrderRows orders={openOrders} onCancel={async (id) => {
              await api.post("/api/paper", { action: "cancel", orderId: id }).catch(() => undefined);
              refresh();
            }} />
          )}
        </Panel>

        <Panel title="ORDER HISTORY">
          {!data ? (
            <div className="p-3 space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : history.length === 0 ? (
            <EmptyState title="No orders today" hint="Filled, cancelled and rejected orders are recorded here." />
          ) : (
            <OrderRows orders={history} />
          )}
        </Panel>
      </div>

      {/* live confirmation */}
      <Modal open={liveModal} onClose={() => setLiveModal(false)} title="LIVE ORDER CONFIRMATION">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Chip tone="danger" className="pulse-soft">LIVE</Chip>
            <p className="text-[12px] text-ink num">{activeSymbol}</p>
          </div>
          <KV k="SIDE" v={side.toUpperCase()} mono={false} />
          <KV k="QUANTITY" v={`${qty} ${activeSymbol}`} />
          <KV k="TYPE" v={type} />
          {stop && <KV k="STOP LOSS" v={fmtPrice(parseFloat(stop))} />}
          {target && <KV k="TARGET" v={fmtPrice(parseFloat(target))} />}
          <KV k="EST. NOTIONAL" v={fmtUsd(notional)} />
          <p className="text-[10px] text-warn leading-snug">
            This submits a real order to CoinDCX Futures if live execution is armed. Review every field.
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setLiveModal(false)}>CANCEL</Btn>
            <Btn variant="danger" onClick={() => void submitLive()}>CONFIRM LIVE ORDER</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OrderRows({ orders, onCancel }: { orders: PaperOrder[]; onCancel?: (id: string) => void }) {
  const { settings } = useApp();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left microlabel border-b border-edge">
            <th className="px-3 py-1.5 font-medium">TIME</th>
            <th className="px-2 py-1.5 font-medium">SYMBOL</th>
            <th className="px-2 py-1.5 font-medium">SIDE</th>
            <th className="px-2 py-1.5 font-medium">TYPE</th>
            <th className="px-2 py-1.5 font-medium text-right">QTY</th>
            <th className="px-2 py-1.5 font-medium text-right">PRICE</th>
            <th className="px-2 py-1.5 font-medium">STATUS</th>
            {onCancel && <th className="px-2 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-edge/50 hover:bg-panel2/50">
              <td className="px-3 py-1.5 num text-dim">{fmtDateTime(new Date(o.createdAt).getTime(), settings.timezone)}</td>
              <td className="px-2 py-1.5 num">{o.symbol}</td>
              <td className={cx("px-2 py-1.5", o.side === "buy" ? "text-up" : "text-dn")}>{o.side.toUpperCase()}</td>
              <td className="px-2 py-1.5 text-mut">{o.type.replace("_", " ")}</td>
              <td className="px-2 py-1.5 num text-right">{o.qty}</td>
              <td className="px-2 py-1.5 num text-right">
                {o.filledPrice ? fmtPrice(o.filledPrice) : o.price ? fmtPrice(o.price) : o.stopPrice ? fmtPrice(o.stopPrice) : "—"}
              </td>
              <td className="px-2 py-1.5">
                <Chip tone={o.status === "filled" ? "up" : o.status === "open" ? "accent" : o.status === "rejected" ? "dn" : "default"}>
                  {o.status.toUpperCase()}
                </Chip>
              </td>
              {onCancel && (
                <td className="px-2 py-1.5 text-right">
                  <Btn variant="ghost" onClick={() => onCancel(o.id)}>CANCEL</Btn>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
