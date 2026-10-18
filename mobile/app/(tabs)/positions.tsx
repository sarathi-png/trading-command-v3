import { useCallback, useState } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "../../src/api/client";
import { Badge, Button, Card, EmptyState, ErrorView, Loading, Row, Screen, SectionTitle, SignedText } from "../../src/components/ui";
import { useSession } from "../../src/state/session";
import { useResource } from "../../src/state/useResource";
import { formatNumber, signColor, space, theme } from "../../src/theme";

export default function PositionsScreen() {
  const router = useRouter();
  const workspace = useSession((state) => state.workspace);
  const settings = useSession((state) => state.settings);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const account = useResource(() => api.account(), [workspace]);
  const paper = useResource(
    () => (workspace === "paper" ? api.paper() : Promise.resolve({ positions: [], orders: [], events: [] })),
    [workspace]
  );

  useFocusEffect(
    useCallback(() => {
      void account.reload();
      void paper.reload();
    }, [account, paper])
  );

  const positions = account.data?.account.positions ?? [];
  const paperPositions = paper.data?.positions ?? [];
  const paperOrders = (paper.data?.orders ?? []).filter((order) => order.status === "open");

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([account.reload(), paper.reload()]);
    setRefreshing(false);
  };

  const closePosition = async (symbol: string) => {
    if (workspace === "live") {
      const verdict = await new Promise<boolean>((resolve) =>
        Alert.alert(
          `Close ${symbol} at market?`,
          "This sends a real exit order to CoinDCX. It cannot be undone.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Close position", style: "destructive", onPress: () => resolve(true) },
          ]
        )
      );
      if (!verdict) return;
      setBusy(symbol);
      try {
        await api.closeLivePosition(symbol);
        await account.reload();
      } catch (error) {
        Alert.alert("Close failed", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy(symbol);
    try {
      await api.placePaperOrder({ action: "close", symbol });
      await Promise.all([account.reload(), paper.reload()]);
    } catch (error) {
      Alert.alert("Close failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  if (account.loading && !account.data) {
    return (
      <Screen>
        <Loading label="Loading positions…" />
      </Screen>
    );
  }
  if (account.error && !account.data) {
    return (
      <Screen>
        <ErrorView message={account.error} onRetry={() => void account.reload()} />
      </Screen>
    );
  }

  const live = workspace === "live";
  const limits = settings?.riskLimits;

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textDim} />}
    >
      <View style={styles.banner}>
        <Badge label={live ? "LIVE" : "PAPER"} tone={live ? "down" : "accent"} />
        <Text style={styles.bannerText}>
          {live
            ? "Real positions at CoinDCX. Closing sends a real exit order."
            : "Simulated positions. No real money is involved."}
        </Text>
      </View>

      <SectionTitle>Open positions</SectionTitle>
      <Card>
        {positions.length === 0 ? (
          <EmptyState title="No open positions" message="Nothing is open in this workspace." />
        ) : (
          positions.map((position) => (
            <View key={position.symbol} style={styles.position}>
              <View style={styles.positionHead}>
                <Text style={styles.symbol}>{position.symbol}</Text>
                <Badge
                  label={position.side.toUpperCase()}
                  tone={position.side === "long" ? "up" : "down"}
                />
              </View>
              <Row label="Quantity" value={formatNumber(position.qty, 4)} />
              <Row label="Entry price" value={formatNumber(position.entry, 2)} />
              <Row label="Mark price" value={formatNumber(position.mark, 2)} />
              <Row
                label="Unrealised P&L"
                value={formatNumber(position.upl, 2)}
                valueColor={signColor(position.upl)}
              />
              <Button
                label="Close at market"
                variant="danger"
                loading={busy === position.symbol}
                onPress={() => void closePosition(position.symbol)}
                style={styles.closeButton}
              />
            </View>
          ))
        )}
      </Card>

      {workspace === "paper" && (paperPositions.length > 0 || paperOrders.length > 0) ? (
        <>
          <SectionTitle>Paper engine</SectionTitle>
          <Card>
            {paperPositions.map((position) => (
              <Row
                key={position.id}
                label={`${position.symbol} ${position.side} ${position.qty}`}
                value={`@ ${formatNumber(position.entry, 2)}`}
              />
            ))}
            {paperOrders.map((order) => (
              <Row
                key={order.id}
                label={`${order.symbol} ${order.side} ${order.qty} (${order.type})`}
                value={order.price ? formatNumber(order.price, 2) : "market"}
              />
            ))}
          </Card>
        </>
      ) : null}

      {limits ? (
        <>
          <SectionTitle>Risk limits</SectionTitle>
          <Card>
            <Row label="Max daily loss" value={formatNumber(limits.maxDailyLoss, 2)} />
            <Row label="Max order value" value={formatNumber(limits.maxOrderValue, 2)} />
            <Row label="Max leverage" value={`${limits.maxLeverage}x`} />
            <Row label="Max open positions" value={String(limits.maxOpenPositions)} />
            <Text style={styles.note}>
              These are the server's limits. Every order — paper or live — is checked against
              them before it is accepted.
            </Text>
          </Card>
        </>
      ) : null}

      <Button
        label="Open the order ticket"
        variant="secondary"
        onPress={() => router.push({ pathname: "/order", params: { symbol: positions[0]?.symbol } })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bannerText: { color: theme.textDim, fontSize: 11, flex: 1, lineHeight: 16 },
  position: { gap: 2, paddingVertical: space.sm },
  positionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
  symbol: { color: theme.text, fontSize: 15, fontWeight: "700" },
  closeButton: { marginTop: space.sm },
  note: { color: theme.textFaint, fontSize: 11, lineHeight: 16, marginTop: space.sm },
});
