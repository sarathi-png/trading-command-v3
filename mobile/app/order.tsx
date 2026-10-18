import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "../src/api/client";
import { Badge, Button, Card, Chip, ChipRow, Row, SectionTitle } from "../src/components/ui";
import { useSession } from "../src/state/session";
import { useResource } from "../src/state/useResource";
import { formatNumber, radius, space, theme } from "../src/theme";

/** A unique key so a retried submission is recognised by the server. */
function clientOrderId(): string {
  const random = () => Math.random().toString(16).slice(2, 10);
  return `tc-${Date.now().toString(36)}-${random()}${random()}`;
}

export default function OrderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const workspace = useSession((state) => state.workspace);
  const settings = useSession((state) => state.settings);

  const [symbol, setSymbol] = useState((params.symbol ?? "BTCUSD").toUpperCase());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const ticker = useResource(
    () => api.tickers([symbol]).then((response) => response.tickers[0] ?? null),
    [symbol]
  );

  useEffect(() => {
    if (params.symbol) setSymbol(String(params.symbol).toUpperCase());
  }, [params.symbol]);

  const price = ticker.data?.price ?? 0;
  const qty = Number(quantity) || 0;
  const notional = qty * (type === "limit" ? Number(limitPrice) || price : price);
  const limits = settings?.riskLimits;
  const overLimit = limits ? notional > limits.maxOrderValue : false;
  const live = workspace === "live";

  const validate = (): string | null => {
    if (!symbol.trim()) return "Symbol required.";
    if (!(qty > 0)) return "Quantity must be greater than zero.";
    if (type === "limit" && !(Number(limitPrice) > 0)) return "A limit order needs a limit price.";
    if (overLimit) return "This order is larger than the server's max order value.";
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      Alert.alert("Cannot send the order", problem);
      return;
    }
    if (live) {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          `Send a LIVE ${side.toUpperCase()} order?`,
          `${qty} ${symbol} will be sent to CoinDCX and can lose real money.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Send", style: "destructive", onPress: () => resolve(true) },
          ]
        )
      );
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      if (live) {
        await api.placeLiveOrder({
          symbol,
          side,
          type: type === "limit" ? "limit_order" : "market_order",
          size: qty,
          limit_price: type === "limit" ? Number(limitPrice) : undefined,
          client_order_id: clientOrderId(),
        });
      } else {
        await api.placePaperOrder({
          action: "place",
          symbol,
          side,
          type: type === "limit" ? "limit" : "market",
          qty,
          price: type === "limit" ? Number(limitPrice) : undefined,
          stop: stop ? Number(stop) : undefined,
          target: target ? Number(target) : undefined,
        });
      }
      Alert.alert(
        "Order accepted",
        live
          ? "The order was submitted to CoinDCX. Check the positions tab for the fill."
          : "The simulated order was placed. Check the positions tab.",
        [{ text: "Done", onPress: () => router.back() }]
      );
    } catch (error) {
      Alert.alert("Order rejected", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <Badge label={live ? "LIVE" : "PAPER"} tone={live ? "down" : "accent"} />
        <Text style={styles.bannerText}>
          {live
            ? "This order is routed to CoinDCX and can lose real money."
            : "This is a simulated order. No real money is involved."}
        </Text>
      </View>

      <Card title="Instrument">
        <ChipRow>
          {["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD"].map((candidate) => (
            <Chip
              key={candidate}
              label={candidate}
              active={candidate === symbol}
              onPress={() => setSymbol(candidate)}
            />
          ))}
        </ChipRow>
        <Row label="Last price" value={ticker.data ? formatNumber(ticker.data.price, 2) : "—"} />
        {ticker.data ? (
          <Row
            label="24h change"
            value={`${ticker.data.change24hPct.toFixed(2)}%`}
            valueColor={ticker.data.change24hPct >= 0 ? theme.up : theme.down}
          />
        ) : null}
      </Card>

      <Card title="Side and order type">
        <ChipRow>
          <Chip label="Buy" active={side === "buy"} tone="up" onPress={() => setSide("buy")} />
          <Chip label="Sell" active={side === "sell"} tone="down" onPress={() => setSide("sell")} />
        </ChipRow>
        <ChipRow>
          <Chip label="Market" active={type === "market"} onPress={() => setType("market")} />
          <Chip label="Limit" active={type === "limit"} onPress={() => setType("limit")} />
        </ChipRow>
      </Card>

      <Card title="Size">
        <Text style={styles.label}>Quantity</Text>
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.textFaint}
          style={styles.input}
        />
        {type === "limit" ? (
          <>
            <Text style={styles.label}>Limit price</Text>
            <TextInput
              value={limitPrice}
              onChangeText={setLimitPrice}
              keyboardType="decimal-pad"
              placeholder={price ? formatNumber(price, 2) : "0.00"}
              placeholderTextColor={theme.textFaint}
              style={styles.input}
            />
          </>
        ) : null}
        {!live ? (
          <>
            <Text style={styles.label}>Stop loss (optional)</Text>
            <TextInput
              value={stop}
              onChangeText={setStop}
              keyboardType="decimal-pad"
              placeholder="none"
              placeholderTextColor={theme.textFaint}
              style={styles.input}
            />
            <Text style={styles.label}>Take profit (optional)</Text>
            <TextInput
              value={target}
              onChangeText={setTarget}
              keyboardType="decimal-pad"
              placeholder="none"
              placeholderTextColor={theme.textFaint}
              style={styles.input}
            />
          </>
        ) : null}
      </Card>

      <SectionTitle>Before you send</SectionTitle>
      <Card>
        <Row label="Order value" value={formatNumber(notional, 2)} />
        {limits ? <Row label="Max order value" value={formatNumber(limits.maxOrderValue, 2)} /> : null}
        {overLimit ? (
          <Text style={styles.warning}>
            This order is above the server's maximum order value and will be rejected.
          </Text>
        ) : null}
        <Text style={styles.hint}>
          The server re-checks the order against its own risk limits, the daily realised P&L it
          can actually prove, and the execution-mode gates. A limit that cannot be proven blocks
          the order.
        </Text>
      </Card>

      <Button
        label={live ? `Send LIVE ${side.toUpperCase()} order` : `Place simulated ${side} order`}
        variant={live ? "danger" : "primary"}
        onPress={() => void submit()}
        loading={busy}
        disabled={Boolean(validate())}
      />
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bannerText: { color: theme.textDim, fontSize: 11, flex: 1, lineHeight: 16 },
  label: { color: theme.textDim, fontSize: 12, marginTop: space.sm },
  input: {
    backgroundColor: theme.bg,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    color: theme.text,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: 4,
  },
  hint: { color: theme.textFaint, fontSize: 11, lineHeight: 16, marginTop: space.sm },
  warning: { color: theme.warn, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});
