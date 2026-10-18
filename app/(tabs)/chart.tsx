import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../../src/api/client";
import { TIMEFRAMES, type Timeframe } from "../../src/api/types";
import { ChartView, type ChartMarker, type ChartPayload } from "../../src/chart/ChartView";
import { Badge, Button, Card, Chip, ChipRow, ErrorView, Loading, Row, SectionTitle, SignedText } from "../../src/components/ui";
import { emaSeries, formatBarTime, toHeikinAshi } from "../../src/lib/indicators";
import { runPine, toBars } from "../../src/pine";
import { usePine } from "../../src/state/pine";
import { useSession } from "../../src/state/session";
import { useResource } from "../../src/state/useResource";
import { formatNumber, formatPercent, signColor, space, theme } from "../../src/theme";

const DEFAULT_SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "DOGEUSD"];

export default function ChartScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const workspace = useSession((state) => state.workspace);
  const settings = useSession((state) => state.settings);

  const [symbol, setSymbol] = useState((params.symbol ?? "BTCUSD").toUpperCase());
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [chartType, setChartType] = useState<"candles" | "heikin-ashi">("candles");
  const [showPine, setShowPine] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const activeScript = usePine((state) => state.active());
  const overrides = usePine((state) => state.overrides);

  const candles = useResource(
    () => api.candles(symbol, timeframe, 300),
    [symbol, timeframe, workspace]
  );
  const analysis = useResource(
    () => api.strategy(symbol, timeframe, chartType),
    [symbol, timeframe, chartType, workspace]
  );
  const tickers = useResource(
    () => api.tickers([symbol]).catch(() => ({ tickers: [], source: "demo" as const, known: [] })),
    [symbol, workspace]
  );

  useEffect(() => {
    if (params.symbol) setSymbol(String(params.symbol).toUpperCase());
  }, [params.symbol]);

  useFocusEffect(
    useCallback(() => {
      void candles.reload();
      void analysis.reload();
    }, [candles.reload, analysis.reload])
  );

  const rawCandles = candles.data?.candles ?? [];
  const chartCandles = useMemo(
    () => (chartType === "heikin-ashi" ? toHeikinAshi(rawCandles) : rawCandles),
    [rawCandles, chartType]
  );

  // The Pine script runs on the device, over the very same candles.
  const pine = useMemo(() => {
    if (!activeScript || !rawCandles.length) return null;
    return runPine(activeScript.source, toBars(rawCandles), {
      symbol,
      timeframe,
      inputOverrides: overrides[activeScript.id] ?? {},
    });
  }, [activeScript, rawCandles, symbol, timeframe, overrides]);

  const payload = useMemo<ChartPayload>(() => {
    const overlays = [];
    if (chartCandles.length) {
      overlays.push({
        id: "ema-fast",
        title: "EMA 21",
        color: "#3d7eff",
        width: 2,
        points: emaSeries(chartCandles, 21),
      });
      overlays.push({
        id: "ema-slow",
        title: "EMA 55",
        color: "#f0b90b",
        width: 2,
        points: emaSeries(chartCandles, 55),
      });
    }
    if (showPine && pine?.ok) {
      for (const plot of pine.plots) {
        overlays.push({
          id: `pine-${plot.title}`,
          title: plot.title,
          color: plot.color,
          width: plot.linewidth,
          points: plot.points,
        });
      }
    }

    const levels = (analysis.data?.analysis?.levels ?? []).slice(0, 8).map((level) => ({
      price: level.price,
      color: level.kind === "support" ? "#26a69a" : "#ef5350",
      kind: level.kind,
      title: level.kind === "support" ? "SUPPORT" : "RESISTANCE",
    }));

    const markers: ChartMarker[] = [];
    for (const signal of analysis.data?.analysis?.signals ?? []) {
      if (signal.status !== "LONG_SETUP" && signal.status !== "SHORT_SETUP") continue;
      markers.push({
        time: Math.floor(signal.ts / 1000),
        position: signal.status === "LONG_SETUP" ? "belowBar" : "aboveBar",
        color: signal.status === "LONG_SETUP" ? "#26a69a" : "#ef5350",
        shape: signal.status === "LONG_SETUP" ? "arrowUp" : "arrowDown",
        text: signal.status === "LONG_SETUP" ? "LONG" : "SHORT",
      });
    }
    for (const trade of pine?.trades ?? []) {
      markers.push({
        time: trade.entryTime,
        position: trade.direction === "long" ? "belowBar" : "aboveBar",
        color: "#f0b90b",
        shape: trade.direction === "long" ? "arrowUp" : "arrowDown",
        text: `${trade.direction === "long" ? "▲" : "▼"} ${trade.id}`,
      });
      if (trade.exitTime) {
        markers.push({
          time: trade.exitTime,
          position: trade.direction === "long" ? "aboveBar" : "belowBar",
          color: "#9aa3b2",
          shape: "circle",
          text: trade.exitReason ?? "exit",
        });
      }
    }

    return {
      candles: chartCandles,
      overlays,
      levels,
      markers,
      chartType,
      error: candles.error ?? undefined,
    };
  }, [chartCandles, analysis.data, pine, showPine, chartType, candles.error]);

  const symbols = useMemo(() => {
    const known = tickers.data?.known ?? [];
    const watchlist = settings?.watchlist ?? [];
    const merged = [...new Set([...watchlist, ...known, ...DEFAULT_SYMBOLS])];
    return merged.slice(0, 40);
  }, [tickers.data, settings]);

  const ticker = tickers.data?.tickers?.[0];
  const analysisData = analysis.data?.analysis;
  const quant = analysis.data?.quant;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([candles.reload(), analysis.reload(), tickers.reload()]);
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.symbolRow}>
          <Text style={styles.symbol}>{symbol}</Text>
          {ticker ? (
            <Text style={styles.price}>{formatNumber(ticker.price, 2)}</Text>
          ) : null}
          {ticker ? (
            <Text style={[styles.change, { color: signColor(ticker.change24hPct) }]}>
              {formatPercent(ticker.change24hPct)}
            </Text>
          ) : null}
          <View style={styles.spacer} />
          <Button
            label="Trade"
            variant="primary"
            onPress={() => router.push({ pathname: "/order", params: { symbol } })}
            style={styles.tradeButton}
          />
        </View>
        <ChipRow>
          {symbols.map((candidate) => (
            <Chip
              key={candidate}
              label={candidate}
              active={candidate === symbol}
              onPress={() => setSymbol(candidate)}
            />
          ))}
        </ChipRow>
        <ChipRow>
          {TIMEFRAMES.map((candidate) => (
            <Chip
              key={candidate}
              label={candidate}
              active={candidate === timeframe}
              onPress={() => setTimeframe(candidate)}
            />
          ))}
          <Chip
            label="Heikin-Ashi"
            active={chartType === "heikin-ashi"}
            onPress={() => setChartType(chartType === "candles" ? "heikin-ashi" : "candles")}
          />
          {activeScript ? (
            <Chip
              label={`Pine: ${activeScript.name}`}
              active={showPine}
              tone="warn"
              onPress={() => setShowPine((value) => !value)}
            />
          ) : null}
        </ChipRow>
      </View>

      <View style={styles.chartArea}>
        {candles.loading && !candles.data ? (
          <Loading label="Loading candles…" />
        ) : candles.error && !candles.data ? (
          <ErrorView message={candles.error} onRetry={() => void candles.reload()} />
        ) : (
          <ChartView payload={payload} />
        )}
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textDim} />
        }
      >
        {analysisData ? (
          <>
            <View style={styles.inlineStats}>
              <Badge
                label={analysisData.trend}
                tone={
                  analysisData.trend === "BULLISH"
                    ? "up"
                    : analysisData.trend === "BEARISH"
                      ? "down"
                      : "muted"
                }
              />
              {quant ? (
                <Badge
                  label={`CONFLUENCE ${quant.confluence.direction} ${quant.confluence.score.toFixed(0)}`}
                  tone={quant.confluence.direction === "LONG" ? "up" : quant.confluence.direction === "SHORT" ? "down" : "muted"}
                />
              ) : null}
              {quant ? <Badge label={quant.regime.toUpperCase()} tone="muted" /> : null}
            </View>

            {analysisData.structureSeq.length ? (
              <Row label="Market structure" value={analysisData.structureSeq.join(" → ")} />
            ) : null}

            {analysisData.signals.length ? (
              <>
                <SectionTitle>Signals</SectionTitle>
                {analysisData.signals.map((signal) => (
                  <View key={`${signal.strategy}-${signal.status}`} style={styles.signal}>
                    <View style={styles.signalHead}>
                      <Text style={styles.signalName}>{signal.strategy}</Text>
                      <Badge
                        label={signal.status.replace("_", " ")}
                        tone={
                          signal.status === "LONG_SETUP"
                            ? "up"
                            : signal.status === "SHORT_SETUP"
                              ? "down"
                              : "muted"
                        }
                      />
                    </View>
                    {signal.entry ? (
                      <Text style={styles.signalLevels}>
                        entry {formatNumber(signal.entry, 2)}
                        {signal.stop ? ` · stop ${formatNumber(signal.stop, 2)}` : ""}
                        {signal.target ? ` · target ${formatNumber(signal.target, 2)}` : ""}
                        {signal.rr ? ` · ${signal.rr.toFixed(1)}R` : ""}
                      </Text>
                    ) : null}
                    {signal.reasons.slice(0, 3).map((reason) => (
                      <Text key={reason} style={styles.reason}>
                        • {reason}
                      </Text>
                    ))}
                  </View>
                ))}
              </>
            ) : null}

            {pine && !pine.ok ? (
              <View style={styles.pineError}>
                <Text style={styles.pineErrorTitle}>Pine script error</Text>
                {pine.errors.map((error, index) => (
                  <Text key={index} style={styles.pineErrorText}>
                    {error.message}
                  </Text>
                ))}
              </View>
            ) : null}

            {pine?.ok && pine.trades.length ? (
              <>
                <SectionTitle>Pine strategy results</SectionTitle>
                <Row label="Trades" value={String(pine.trades.length)} />
                <Row
                  label="Net profit"
                  value={formatNumber(pine.stats?.netProfit ?? 0, 2)}
                  valueColor={signColor(pine.stats?.netProfit)}
                />
                <Row label="Win rate" value={`${(pine.stats?.winRate ?? 0).toFixed(0)}%`} />
              </>
            ) : null}
          </>
        ) : analysis.error ? (
          <Text style={styles.muted}>{analysis.error}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  symbolRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  symbol: { color: theme.text, fontSize: 18, fontWeight: "800" },
  price: { color: theme.text, fontSize: 15, fontWeight: "600" },
  change: { fontSize: 13, fontWeight: "600" },
  spacer: { flex: 1 },
  tradeButton: { paddingVertical: 8, paddingHorizontal: space.md },
  chartArea: { flex: 1, minHeight: 260 },
  panel: {
    maxHeight: 320,
    backgroundColor: theme.panel,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  panelContent: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  inlineStats: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  signal: { borderTopWidth: 1, borderTopColor: theme.borderSoft, paddingTop: space.sm, marginTop: space.xs },
  signalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  signalName: { color: theme.text, fontSize: 13, fontWeight: "700" },
  signalLevels: { color: theme.textDim, fontSize: 11, marginTop: 3 },
  reason: { color: theme.textFaint, fontSize: 11, marginTop: 2, lineHeight: 16 },
  pineError: {
    backgroundColor: theme.downSoft,
    borderRadius: 8,
    padding: space.md,
    borderWidth: 1,
    borderColor: theme.down,
    marginTop: space.sm,
  },
  pineErrorTitle: { color: theme.down, fontWeight: "700", fontSize: 12 },
  pineErrorText: { color: theme.text, fontSize: 11, marginTop: 3 },
  muted: { color: theme.textFaint, fontSize: 12 },
});
