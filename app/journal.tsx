import { useCallback, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { api } from "../src/api/client";
import { Badge, Card, EmptyState, ErrorView, Loading, Row, Screen, SectionTitle } from "../src/components/ui";
import { useSession } from "../src/state/session";
import { useResource } from "../src/state/useResource";
import { formatMoney, formatNumber, signColor, space, theme } from "../src/theme";

export default function JournalScreen() {
  const workspace = useSession((state) => state.workspace);
  const [refreshing, setRefreshing] = useState(false);

  const journal = useResource(() => api.journal(), [workspace]);

  useFocusEffect(
    useCallback(() => {
      void journal.reload();
    }, [journal])
  );

  const entries = journal.data?.entries ?? [];
  const summary = useMemo(() => {
    const closed = entries.filter((entry) => entry.exit !== null);
    const wins = closed.filter((entry) => entry.pnl > 0);
    const losses = closed.filter((entry) => entry.pnl < 0);
    const net = closed.reduce((total, entry) => total + entry.pnl, 0);
    return {
      closed: closed.length,
      net,
      winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      best: wins.length ? Math.max(...wins.map((entry) => entry.pnl)) : 0,
      worst: losses.length ? Math.min(...losses.map((entry) => entry.pnl)) : 0,
    };
  }, [entries]);

  const onRefresh = async () => {
    setRefreshing(true);
    await journal.reload();
    setRefreshing(false);
  };

  if (journal.loading && !journal.data) {
    return (
      <Screen>
        <Loading label="Loading journal…" />
      </Screen>
    );
  }
  if (journal.error && !journal.data) {
    return (
      <Screen>
        <ErrorView message={journal.error} onRetry={() => void journal.reload()} />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textDim} />}
    >
      <View style={styles.summaryRow}>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>TRADES</Text>
          <Text style={styles.summaryValue}>{summary.closed}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>NET</Text>
          <Text style={[styles.summaryValue, { color: signColor(summary.net) }]}>
            {formatMoney(summary.net, 2)}
          </Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>WIN RATE</Text>
          <Text style={styles.summaryValue}>{summary.winRate.toFixed(0)}%</Text>
        </View>
      </View>

      {journal.data?.notice ? <Text style={styles.notice}>{journal.data.notice}</Text> : null}

      <SectionTitle>Closed trades</SectionTitle>
      {entries.length === 0 ? (
        <Card>
          <EmptyState
            title="No trades recorded"
            message="The journal is written automatically when a trade closes — it cannot be edited or deleted."
          />
        </Card>
      ) : (
        entries.slice(0, 60).map((entry) => (
          <Card key={entry.id ?? `${entry.symbol}-${entry.openedAt}`} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text style={styles.entrySymbol}>{entry.symbol}</Text>
              <Badge
                label={entry.direction.toUpperCase()}
                tone={entry.direction === "long" ? "up" : "down"}
              />
              <Text style={[styles.entryPnl, { color: signColor(entry.pnl) }]}>
                {formatMoney(entry.pnl, 2)}
              </Text>
            </View>
            <Row
              label="Entry → exit"
              value={`${formatNumber(entry.entry, 2)} → ${
                entry.exit ? formatNumber(entry.exit, 2) : "open"
              }`}
            />
            <Row label="Quantity" value={formatNumber(entry.qty, 4)} />
            <Row label="Strategy" value={entry.strategy || "—"} />
            {entry.reason ? <Row label="Reason" value={entry.reason} /> : null}
            {entry.fees ? <Row label="Fees" value={formatNumber(entry.fees, 2)} /> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: "row", gap: space.sm },
  summaryTile: {
    flex: 1,
    backgroundColor: theme.panel,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: space.md,
    gap: 2,
  },
  summaryLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 0.6 },
  summaryValue: { color: theme.text, fontSize: 17, fontWeight: "700" },
  notice: { color: theme.textFaint, fontSize: 11, lineHeight: 16 },
  entry: { gap: 2 },
  entryHead: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  entrySymbol: { color: theme.text, fontSize: 14, fontWeight: "700" },
  entryPnl: { marginLeft: "auto", fontSize: 14, fontWeight: "700" },
});
