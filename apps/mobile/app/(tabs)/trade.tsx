import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { Mode, PaperOrder, PaperPosition, PaperState } from "@/src/api/types";
import { formatPrice, formatQty, formatSignedMoney } from "@/src/lib/format";
import { modeLabel, modeTone, type StatusTone } from "@/src/lib/status";
import {
  newClientOrderId,
  parseQty,
  submitBlocker,
  type OrderSide,
  type TicketDraft,
} from "@/src/lib/intent";
import { errorText, useApi } from "@/src/state/api";
import { useIntent } from "@/src/state/intent";
import { useSettings } from "@/src/state/settings";
import { usePoll } from "@/src/state/usePoll";
import { useWorkspace } from "@/src/state/workspace";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  MutedText,
  Screen,
  SectionTitle,
  SideSwitch,
} from "@/src/ui/components";
import { colors, font, space } from "@/src/ui/theme";

const POLL_MS = 15_000;

export default function TradeScreen() {
  const { workspace, setWorkspace } = useWorkspace();
  const { mode, error: settingsError, setMode } = useSettings();
  const { intent, clearIntent } = useIntent();
  const api = useApi();

  const [state, setState] = useState<PaperState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // Bumped after a successful order so the ticket remounts with a fresh
  // idempotency key even when there is no signal intent to clear.
  const [ticketEpoch, setTicketEpoch] = useState(0);

  const refresh = useCallback(async () => {
    if (workspace !== "paper") {
      setState(null);
      setLoading(false);
      return;
    }
    try {
      const next = await api.get<PaperState>("/api/paper");
      setState(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api, workspace]);

  usePoll(refresh, POLL_MS, workspace === "paper");

  function confirmSwitchToPaper() {
    Alert.alert(
      "Switch the server to PAPER?",
      "This changes the execution mode for the whole deployment, including the web app. It does not place an order.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch to PAPER", onPress: () => void switchToPaper() },
      ]
    );
  }

  async function switchToPaper() {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      await setMode("paper");
      setNotice("Server mode is now PAPER.");
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSwitching(false);
    }
  }

  function reviewOrder(draft: TicketDraft) {
    if (placing) return;
    const parsed = parseQty(draft.qty);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    Alert.alert(
      "Confirm paper order",
      `${draft.side.toUpperCase()} ${parsed.qty} ${draft.symbol} at market\nClient id: ${draft.clientOrderId}${
        draft.signalId ? `\nFrom signal ${draft.signalId}` : ""
      }`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Place paper order", onPress: () => void placeOrder(draft, parsed.qty) },
      ]
    );
  }

  async function placeOrder(draft: TicketDraft, parsedQty: number) {
    if (placing) return;
    setPlacing(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<PaperState>("/api/paper", {
        action: "place",
        symbol: draft.symbol,
        side: draft.side,
        type: "market",
        qty: parsedQty,
        client_order_id: draft.clientOrderId,
        ...(typeof draft.stop === "number" ? { stop: draft.stop } : {}),
        ...(typeof draft.target === "number" ? { target: draft.target } : {}),
      });
      setState({
        positions: result.positions ?? [],
        orders: result.orders ?? [],
        fills: result.fills ?? [],
        events: result.events,
      });
      const placed = result.orders?.find((order) => order.clientOrderId === draft.clientOrderId);
      setNotice(`Paper order ${placed?.status ?? "accepted"}.`);
      setTicketEpoch((epoch) => epoch + 1);
      if (intent) clearIntent();
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPlacing(false);
    }
  }

  function confirmClose(position: PaperPosition) {
    Alert.alert(
      "Close position?",
      `Close ${position.side} ${formatQty(position.qty)} ${position.symbol} at market?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Close", style: "destructive", onPress: () => void closePosition(position) },
      ]
    );
  }

  async function closePosition(position: PaperPosition) {
    if (closingId) return;
    setClosingId(position.id);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<{ ok: boolean; events?: { kind: string; message: string }[] }>("/api/paper", {
        action: "close",
        positionId: position.id,
        // The server prices the close from `symbol`; without it the request is
        // rejected with "No price available for symbol".
        symbol: position.symbol,
      });
      const messages = (result.events ?? []).map((event) => event.message).filter(Boolean);
      setNotice(messages.length > 0 ? messages.join(" · ") : `Closed ${position.symbol}.`);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setClosingId(null);
    }
  }

  function clearTicket() {
    clearIntent();
    setTicketEpoch((epoch) => epoch + 1);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Trade</Text>
        <Badge label={modeLabel(mode)} tone={modeTone(mode)} />
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      {workspace === "live" ? (
        <Card>
          <Badge label="LIVE · READ ONLY" tone="live" />
          <Text style={styles.cardTitle}>Live order entry is disabled</Text>
          <MutedText>
            This build never renders a live ticket and cannot arm live trading. Switch back to the paper
            workspace to simulate orders.
          </MutedText>
          <Button label="Back to PAPER workspace" tone="paper" onPress={() => setWorkspace("paper")} />
        </Card>
      ) : (
        <>
          {mode !== "paper" ? (
            <Card>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>EXECUTION LOCKED</Text>
                <Badge label={modeLabel(mode)} tone={modeTone(mode)} />
              </View>
              <MutedText>
                {mode
                  ? "Paper orders are refused by the server in this mode."
                  : "Waiting for the server to report its mode."}
              </MutedText>
              {mode ? (
                <Button
                  label="Switch server to PAPER"
                  tone="paper"
                  busy={switching}
                  onPress={confirmSwitchToPaper}
                />
              ) : null}
              {settingsError ? <ErrorText>{settingsError}</ErrorText> : null}
            </Card>
          ) : null}

          <SectionTitle right={<Badge label={`${state?.positions.length ?? 0} OPEN`} tone="neutral" />}>
            POSITIONS
          </SectionTitle>
          <Card>
            {loading && !state ? <MutedText>Loading paper state…</MutedText> : null}
            {state && state.positions.length === 0 ? (
              <EmptyState title="No open paper positions" detail="Filled market orders appear here." />
            ) : null}
            {state?.positions.map((position) => (
              <View key={position.id} style={styles.position}>
                <View style={styles.positionHead}>
                  <Text style={styles.symbol}>{position.symbol}</Text>
                  <Badge
                    label={position.side.toUpperCase()}
                    tone={position.side === "long" ? "positive" : "negative"}
                  />
                  <View style={styles.grow} />
                  <Button
                    label="Close"
                    compact
                    tone="neutral"
                    busy={closingId === position.id}
                    disabled={Boolean(closingId) || mode !== "paper"}
                    onPress={() => confirmClose(position)}
                  />
                </View>
                <Text style={styles.mono}>
                  {formatQty(position.qty)} @ {formatPrice(position.entry)} · mark {formatPrice(position.mark)}
                </Text>
                <Text style={styles.mono}>
                  uPnL {formatSignedMoney(position.upl)} · realized {formatSignedMoney(position.realizedPnl)}
                </Text>
              </View>
            ))}
          </Card>

          <SectionTitle right={intent ? <Badge label="FROM SIGNAL" tone="accent" /> : null}>
            PAPER TICKET
          </SectionTitle>
          <TicketForm
            key={`${intent?.signalId ?? "manual"}-${ticketEpoch}`}
            intent={intent}
            mode={mode}
            placing={placing}
            onReview={reviewOrder}
            onClear={clearTicket}
          />

          <SectionTitle right={<Badge label="RECENT" tone="neutral" />}>PAPER ORDERS</SectionTitle>
          <Card>
            {state && state.orders.length === 0 ? (
              <EmptyState title="No paper orders yet" detail="Placed orders and their status appear here." />
            ) : null}
            {state?.orders.slice(0, 8).map((order) => (
              <View key={order.id} style={styles.orderRow}>
                <View style={styles.grow}>
                  <Text style={styles.orderTitle}>
                    {order.side.toUpperCase()} {formatQty(order.qty)} {order.symbol}
                  </Text>
                  <Text style={styles.orderMeta}>
                    {order.type.replace("_", " ")} ·{" "}
                    {order.filledPrice != null ? formatPrice(order.filledPrice) : "no fill"}
                  </Text>
                </View>
                <Badge label={order.status.toUpperCase()} tone={orderTone(order.status)} />
              </View>
            ))}
          </Card>

          <SectionTitle right={<Badge label="LATEST" tone="neutral" />}>FILLS</SectionTitle>
          <Card>
            {state && state.fills.length === 0 ? (
              <EmptyState title="No fills yet" detail="Closed trades show their realized P&L here." />
            ) : null}
            {state?.fills.slice(0, 8).map((fill) => (
              <View key={fill.id} style={styles.orderRow}>
                <View style={styles.grow}>
                  <Text style={styles.orderTitle}>
                    {fill.kind.toUpperCase()} {fill.side.toUpperCase()} {formatQty(fill.qty)} {fill.symbol}
                  </Text>
                  <Text style={styles.orderMeta}>@ {formatPrice(fill.price)}</Text>
                </View>
                <Text
                  style={[
                    styles.mono,
                    { color: fill.realizedPnl >= 0 ? colors.positive : colors.negative },
                  ]}
                >
                  {formatSignedMoney(fill.realizedPnl)}
                </Text>
              </View>
            ))}
          </Card>

          <Text style={styles.footer}>
            Paper orders require confirmation and are idempotent per client id. No live order can be placed
            from this screen.
          </Text>
        </>
      )}
    </Screen>
  );
}

/**
 * Local ticket form.
 *
 * The parent remounts this component when a signal intent arrives or after a
 * successful order, so the idempotency key is initialized once per ticket
 * without state-syncing effects. Retrying a failed submission keeps the same
 * key, which is exactly what the paper endpoint expects.
 */
function TicketForm({
  intent,
  mode,
  placing,
  onReview,
  onClear,
}: {
  intent: TicketDraft | null;
  mode: Mode | null;
  placing: boolean;
  onReview: (draft: TicketDraft) => void;
  onClear: () => void;
}) {
  const [symbol, setSymbol] = useState(() => intent?.symbol ?? "");
  const [side, setSide] = useState<OrderSide>(() => intent?.side ?? "buy");
  const [qty, setQty] = useState(() => intent?.qty ?? "0.001");
  const [clientOrderId] = useState(() => intent?.clientOrderId ?? newClientOrderId());

  const draft: TicketDraft = {
    symbol: symbol.trim().toUpperCase(),
    side,
    qty,
    clientOrderId,
    signalId: intent?.signalId,
    entry: intent?.entry,
    stop: intent?.stop,
    target: intent?.target,
  };
  const blocker = mode ? submitBlocker(draft, mode) : "Checking the server's execution mode…";

  return (
    <Card>
      {intent?.signalId ? (
        <View style={styles.intentRow}>
          <MutedText>Signal {intent.signalId}</MutedText>
          <Button label="Clear" compact tone="neutral" onPress={onClear} />
        </View>
      ) : null}

      <Field
        label="SYMBOL"
        value={symbol}
        onChangeText={(value) => setSymbol(value.toUpperCase())}
        placeholder="BTCUSD"
        autoCapitalize="characters"
      />
      <Text style={styles.fieldLabel}>SIDE</Text>
      <SideSwitch value={side} onChange={setSide} />
      <Field
        label="QUANTITY"
        value={qty}
        onChangeText={setQty}
        placeholder="0.001"
        keyboardType="decimal-pad"
      />

      {intent ? (
        <MutedText>
          Price {formatPrice(intent.entry)} · stop {formatPrice(intent.stop)} · target{" "}
          {formatPrice(intent.target)}
        </MutedText>
      ) : null}

      <Button
        label="Review & confirm"
        tone={side === "buy" ? "positive" : "negative"}
        busy={placing}
        disabled={Boolean(blocker) || placing}
        onPress={() => onReview(draft)}
      />

      {blocker ? (
        <Text style={styles.blocker}>{blocker}</Text>
      ) : (
        <Text style={styles.helper}>Market order · id {clientOrderId} (reused on retry)</Text>
      )}
    </Card>
  );
}

function orderTone(status: PaperOrder["status"]): StatusTone {
  if (status === "filled") return "positive";
  if (status === "rejected") return "negative";
  if (status === "open") return "warning";
  return "neutral";
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  cardTitle: { color: colors.muted, fontSize: 12, letterSpacing: 1.6, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  intentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  position: {
    gap: 3,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  positionHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  symbol: { color: colors.text, fontSize: 15, fontWeight: "700", fontFamily: font.mono },
  grow: { flex: 1 },
  mono: { color: colors.muted, fontSize: 12, fontFamily: font.mono },
  fieldLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  blocker: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  helper: { color: colors.dim, fontSize: 11 },
  notice: { color: colors.positive, fontSize: 12 },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  orderTitle: { color: colors.text, fontSize: 13, fontFamily: font.mono },
  orderMeta: { color: colors.dim, fontSize: 11 },
  footer: { color: colors.dim, fontSize: 11, textAlign: "center", lineHeight: 16 },
});
