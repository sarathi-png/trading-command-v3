import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../../src/api/client";
import { Badge, Button, Card, ErrorView, Loading, Row, Screen, SectionTitle, SignedText, StatTile } from "../../src/components/ui";
import { useSession } from "../../src/state/session";
import { useResource } from "../../src/state/useResource";
import { formatMoney, formatNumber, formatPercent, radius, signColor, space, theme } from "../../src/theme";

export default function OverviewScreen() {
  const router = useRouter();
  const workspace = useSession((state) => state.workspace);
  const system = useSession((state) => state.system);
  const settings = useSession((state) => state.settings);
  const [refreshing, setRefreshing] = useState(false);

  const account = useResource(() => api.account(), [workspace]);
  const movers = useResource(() => api.movers().catch(() => ({ movers: [] })), [workspace]);

  useFocusEffect(
    useCallback(() => {
      void account.reload();
    }, [account])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([account.reload(), movers.reload()]);
    setRefreshing(false);
  };

  if (account.loading && !account.data) {
    return (
      <Screen>
        <Loading label="Loading account…" />
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

  const state = account.data?.account;
  const isLive = workspace === "live";
  const positions = state?.positions ?? [];

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textDim} />}
    >
      <View style={styles.bannerRow}>
        <Badge
          label={isLive ? "LIVE WORKSPACE" : "PAPER WORKSPACE"}
          tone={isLive ? "down" : "accent"}
        />
        <Text style={styles.bannerText}>
          {system?.execution ?? "—"} · {settings?.dataSource === "demo" ? "demo data" : "live market data"}
        </Text>
      </View>

      {isLive && !system?.exchange?.liveExecutionEnabled ? (
        <Card>
          <Text style={styles.warningTitle}>Live execution is disabled on the server</Text>
          <Text style={styles.warningBody}>
            The server has LIVE_EXECUTION_ENABLED=false, so no order can be placed. Reading still works.
          </Text>
        </Card>
      ) : null}

      <View style={styles.tiles}>
        <StatTile
          label="EQUITY"
          value={formatNumber(state?.equity, 2)}
          color={theme.text}
          caption={state?.source === "live" ? "CoinDCX wallet" : "Simulated"}
        />
        <StatTile
          label="TODAY"
          value={formatMoney(state?.todayPnl, 2)}
          color={signColor(state?.todayPnl)}
          caption="realised + open"
        />
        <StatTile
          label="OPEN P&L"
          value={formatMoney(state?.openPnl, 2)}
          color={signColor(state?.openPnl)}
          caption={`${positions.length} open`}
        />
      </View>

      <View style={styles.tiles}>
        <StatTile
          label="AVAILABLE"
          value={formatNumber(state?.availableMargin, 2)}
          caption="free margin"
        />
        <StatTile
          label="MARGIN USED"
          value={formatNumber(state?.marginUsed, 2)}
          caption="in positions"
        />
        <StatTile
          label="STARTING"
          value={formatNumber(state?.startingBalance, 2)}
          caption="balance"
        />
      </View>

      <SectionTitle
        right={
          <Link href="/positions" asChild>
            <Text style={styles.link}>All positions</Text>
          </Link>
        }
      >
        Open positions
      </SectionTitle>
      <Card>
        {positions.length === 0 ? (
          <Text style={styles.muted}>No open positions in this workspace.</Text>
        ) : (
          positions.map((position) => (
            <View key={position.symbol} style={styles.positionRow}>
              <View style={styles.positionLeft}>
                <Text style={styles.symbol}>{position.symbol}</Text>
                <Text style={styles.positionMeta}>
                  {position.side === "long" ? "LONG" : "SHORT"} · {formatNumber(position.qty, 4)} @{" "}
                  {formatNumber(position.entry, 2)}
                </Text>
              </View>
              <View style={styles.positionRight}>
                <Text style={styles.mark}>{formatNumber(position.mark, 2)}</Text>
                <SignedText value={position.upl} format={(value) => formatMoney(value, 2)} />
              </View>
            </View>
          ))
        )}
      </Card>

      <SectionTitle>Market pulse</SectionTitle>
      <Card>
        {(movers.data?.movers ?? []).length === 0 ? (
          <Text style={styles.muted}>
            No movers reported. The market-pulse module may be disabled on this deployment.
          </Text>
        ) : (
          (movers.data?.movers ?? []).slice(0, 6).map((mover) => (
            <Row
              key={mover.symbol}
              label={mover.symbol}
              value={`${formatNumber(mover.price, 2)}  ${formatPercent(mover.changePct)}`}
              valueColor={signColor(mover.changePct)}
            />
          ))
        )}
      </Card>

      <SectionTitle>System</SectionTitle>
      <Card>
        <Row label="Database" value={system?.db ? "connected" : "unavailable"} valueColor={system?.db ? theme.up : theme.down} />
        <Row label="Market data" value={system?.exchangeMarket ?? "—"} />
        <Row label="Private account" value={system?.exchangeAccount ?? "—"} />
        <Row label="Strategy engine" value={system?.strategy ? "enabled" : "disabled"} />
        <Row label="Paper trading" value={system?.flags?.PAPER_TRADING ? "enabled" : "disabled"} />
        <Row label="Server version" value={system?.version ?? "—"} />
      </Card>

      <Button
        label="Open the chart"
        variant="secondary"
        onPress={() => router.push("/(tabs)/chart")}
        style={styles.fullWidth}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bannerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bannerText: { color: theme.textDim, fontSize: 11, flex: 1 },
  warningTitle: { color: theme.warn, fontSize: 13, fontWeight: "700" },
  warningBody: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  tiles: { flexDirection: "row", gap: space.sm },
  positionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.sm,
    gap: space.md,
  },
  positionLeft: { flex: 1 },
  positionRight: { alignItems: "flex-end" },
  symbol: { color: theme.text, fontSize: 14, fontWeight: "700" },
  positionMeta: { color: theme.textFaint, fontSize: 11, marginTop: 2 },
  mark: { color: theme.textDim, fontSize: 12, marginBottom: 2 },
  muted: { color: theme.textFaint, fontSize: 12, lineHeight: 18 },
  link: { color: theme.accent, fontSize: 12, fontWeight: "600" },
  fullWidth: { marginTop: space.sm },
});
