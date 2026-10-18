import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../../src/api/client";
import { Badge, EmptyState, ErrorView, Loading, Screen } from "../../src/components/ui";
import { useSession } from "../../src/state/session";
import { useResource } from "../../src/state/useResource";
import { formatNumber, formatPercent, radius, signColor, space, theme } from "../../src/theme";

export default function MarketsScreen() {
  const router = useRouter();
  const workspace = useSession((state) => state.workspace);
  const settings = useSession((state) => state.settings);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const tickers = useResource(() => api.tickers(), [workspace]);

  const rows = useMemo(() => {
    const all = tickers.data?.tickers ?? [];
    const watchlist = new Set(settings?.watchlist ?? []);
    const filtered = query.trim()
      ? all.filter((ticker) => ticker.symbol.toLowerCase().includes(query.trim().toLowerCase()))
      : all;
    // Watchlist symbols first, then the rest by absolute 24h move.
    return [...filtered].sort((a, b) => {
      const aWatch = watchlist.has(a.symbol) ? 0 : 1;
      const bWatch = watchlist.has(b.symbol) ? 0 : 1;
      if (aWatch !== bWatch) return aWatch - bWatch;
      return Math.abs(b.change24hPct) - Math.abs(a.change24hPct);
    });
  }, [tickers.data, settings, query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await tickers.reload();
    setRefreshing(false);
  };

  if (tickers.loading && !tickers.data) {
    return (
      <Screen>
        <Loading label="Loading market data…" />
      </Screen>
    );
  }
  if (tickers.error && !tickers.data) {
    return (
      <Screen>
        <ErrorView message={tickers.error} onRetry={() => void tickers.reload()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color={theme.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter symbols"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.search}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={theme.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.symbol}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textDim} />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="No symbols"
            message={
              tickers.data?.source === "demo"
                ? "The demo simulator only publishes a few pairs. Switch the data source to live in Settings."
                : "The venue returned no instruments."
            }
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/(tabs)/chart", params: { symbol: item.symbol } })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.panelAlt }]}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.meta}>
                vol {formatNumber(item.volume24hUsd / 1000, 0)}k
                {item.fundingRate !== null ? ` · funding ${item.fundingRate.toFixed(4)}%` : ""}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.price}>{formatNumber(item.price, 2)}</Text>
              <View style={styles.changeRow}>
                {item.change24hAvailable === false ? (
                  <Badge label="no 24h stat" tone="muted" />
                ) : (
                  <Text style={[styles.change, { color: signColor(item.change24hPct) }]}>
                    {formatPercent(item.change24hPct)}
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    margin: space.lg,
    marginBottom: 0,
    backgroundColor: theme.panel,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: space.md,
  },
  search: { flex: 1, color: theme.text, paddingVertical: 10, fontSize: 14 },
  list: { padding: space.lg, gap: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: theme.panel,
    borderRadius: radius.sm,
    gap: space.md,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: "flex-end" },
  symbol: { color: theme.text, fontSize: 14, fontWeight: "700" },
  meta: { color: theme.textFaint, fontSize: 10, marginTop: 2 },
  price: { color: theme.text, fontSize: 14, fontWeight: "600" },
  changeRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  change: { fontSize: 12, fontWeight: "600" },
});
