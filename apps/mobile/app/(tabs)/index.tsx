import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { SystemStatus, Ticker, TickerEnvelope } from "@/src/api/types";
import { formatClock, formatMoney, formatPct, formatPrice, stalenessLabel } from "@/src/lib/format";
import { modeLabel, modeTone } from "@/src/lib/status";
import { errorText, useApi } from "@/src/state/api";
import { useSession } from "@/src/state/session";
import { useSettings } from "@/src/state/settings";
import { usePoll } from "@/src/state/usePoll";
import { useWorkspace } from "@/src/state/workspace";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  KeyValue,
  MutedText,
  Screen,
  SectionTitle,
  WorkspaceSwitch,
} from "@/src/ui/components";
import { colors, font, space } from "@/src/ui/theme";

const POLL_MS = 15_000;

export default function HomeScreen() {
  const { signOut } = useSession();
  const { workspace, setWorkspace } = useWorkspace();
  const { mode, data: settings, error: settingsError } = useSettings();
  const api = useApi();

  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [market, setMarket] = useState<TickerEnvelope | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const watchKey = settings?.settings.watchlist.join(",") ?? "";

  const refresh = useCallback(async () => {
    const [systemResult, marketResult] = await Promise.allSettled([
      api.get<SystemStatus>("/api/system"),
      api.get<TickerEnvelope>(
        watchKey
          ? `/api/market/tickers?symbols=${encodeURIComponent(watchKey)}`
          : "/api/market/tickers"
      ),
    ]);

    if (systemResult.status === "fulfilled") {
      setSystem(systemResult.value);
      setSystemError(null);
    } else {
      setSystemError(errorText(systemResult.reason));
    }

    if (marketResult.status === "fulfilled") {
      setMarket(marketResult.value);
      setMarketError(marketResult.value.error ?? null);
    } else {
      setMarketError(errorText(marketResult.reason));
    }
    setLoading(false);
  }, [api, watchKey]);

  usePoll(refresh, POLL_MS, true);

  function confirmSignOut() {
    Alert.alert("Sign out?", "The session token is removed from the device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  const modeCopy =
    mode === "paper"
      ? "The server accepts simulated orders. Nothing reaches an exchange."
      : mode === "live"
        ? "The server is in LIVE mode. This build never offers live order entry."
        : mode === "read_only"
          ? "Execution is disabled. Markets are view-only until the server is switched to PAPER."
          : "Waiting for the server to report its mode.";

  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.brand}>TRADING COMMAND</Text>
          <Text style={styles.version}>{system ? `v${system.version}` : "status unavailable"}</Text>
        </View>
        <Button label="Sign out" tone="neutral" compact onPress={confirmSignOut} />
      </View>

      <Card>
        <Text style={styles.cardTitle}>WORKSPACE</Text>
        <WorkspaceSwitch value={workspace} onChange={setWorkspace} />
        <MutedText>
          {workspace === "paper"
            ? "Paper workspace: simulated positions, orders and fills."
            : "Live workspace: read-only in this build. Live order entry is not offered."}
        </MutedText>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>EXECUTION MODE</Text>
          <Badge label={modeLabel(mode)} tone={modeTone(mode)} />
        </View>
        {settingsError ? <ErrorText>{settingsError}</ErrorText> : null}
        <MutedText>{modeCopy}</MutedText>
        <KeyValue
          label="Data source"
          value={settings ? (settings.settings.dataSource === "live" ? "LIVE" : "DEMO") : "unavailable"}
          tone={settings?.settings.dataSource === "live" ? "positive" : undefined}
        />
        <KeyValue
          label="Paper module"
          value={settings ? (settings.capabilities.paperTrading ? "enabled" : "disabled") : "unavailable"}
        />
        <KeyValue
          label="Live execution"
          value={settings ? (settings.capabilities.liveExecution ? "enabled on server" : "disabled") : "unavailable"}
        />
      </Card>

      <SectionTitle
        right={
          system ? (
            <Badge label="SYSTEM" tone={systemError ? "warning" : "positive"} />
          ) : (
            <Badge label={loading ? "LOADING" : "UNAVAILABLE"} tone="neutral" />
          )
        }
      >
        SYSTEM
      </SectionTitle>
      <Card>
        {systemError ? <ErrorText>{systemError}</ErrorText> : null}
        {system ? (
          <>
            <KeyValue label="Database" value={system.db ? "connected" : "unavailable"} tone={system.db ? "positive" : "negative"} />
            <KeyValue
              label="Exchange market"
              value={system.exchangeMarket}
              tone={system.exchangeMarket === "online" ? "positive" : system.exchangeMarket === "offline" ? "negative" : "neutral"}
            />
            <KeyValue label="Webhook" value={system.webhook ? "enabled" : "disabled"} />
            <KeyValue label="Strategy engine" value={system.strategy ? "enabled" : "disabled"} />
            <KeyValue label="Version" value={system.version} />
          </>
        ) : !systemError ? (
          <MutedText>Loading system status…</MutedText>
        ) : null}
      </Card>

      <SectionTitle
        right={
          <Badge
            label={market ? stalenessLabel(market.stale, market.asOf) : "AS OF UNAVAILABLE"}
            tone={market ? (market.stale ? "warning" : "positive") : "neutral"}
          />
        }
      >
        WATCHLIST
      </SectionTitle>
      <Card>
        {marketError ? <ErrorText>{marketError}</ErrorText> : null}
        {market ? (
          <MutedText>
            {market.provider ?? "provider unavailable"}
            {market.source ? ` · ${market.source}` : ""} · as of {formatClock(market.asOf)}
          </MutedText>
        ) : null}
        {!market || market.tickers.length === 0 ? (
          <EmptyState
            title={loading ? "Loading quotes…" : "Market data unavailable"}
            detail="A missing snapshot is shown as unavailable, never as a zero price."
          />
        ) : (
          market.tickers.map((ticker) => <TickerRow key={ticker.symbol} ticker={ticker} />)
        )}
      </Card>

      <Text style={styles.footer}>
        Foreground refresh every {POLL_MS / 1000} s. No push notifications in v1.
      </Text>
    </Screen>
  );
}

function TickerRow({ ticker }: { ticker: Ticker }) {
  const change = ticker.change24hAvailable === false ? null : ticker.change24hPct;
  return (
    <View style={styles.tickerRow}>
      <View style={styles.tickerLeft}>
        <View style={styles.symbolRow}>
          <Text style={styles.symbol}>{ticker.symbol}</Text>
          {ticker.stale ? <Badge label="STALE" tone="warning" /> : null}
        </View>
        <Text style={styles.tickerMeta}>
          {Number.isFinite(ticker.volume24hUsd)
            ? `24h vol ${formatMoney(ticker.volume24hUsd, "usd", 0)}`
            : "volume unavailable"}
        </Text>
      </View>
      <View style={styles.tickerRight}>
        <Text style={styles.price}>{formatPrice(ticker.price)}</Text>
        <Text
          style={[
            styles.change,
            { color: change === null ? colors.dim : change >= 0 ? colors.positive : colors.negative },
          ]}
        >
          {change === null ? "change unavailable" : formatPct(change)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  headerText: { gap: 2, flex: 1 },
  brand: { color: colors.accent, fontSize: 11, letterSpacing: 3, fontWeight: "700" },
  version: { color: colors.dim, fontSize: 11 },
  cardTitle: { color: colors.muted, fontSize: 12, letterSpacing: 1.6, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  tickerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.md,
  },
  tickerLeft: { flex: 1, gap: 2 },
  symbolRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  symbol: { color: colors.text, fontSize: 15, fontWeight: "700", fontFamily: font.mono },
  tickerMeta: { color: colors.dim, fontSize: 11 },
  tickerRight: { alignItems: "flex-end", gap: 2 },
  price: { color: colors.text, fontSize: 15, fontFamily: font.mono },
  change: { fontSize: 11, fontFamily: font.mono },
  footer: { color: colors.dim, fontSize: 11, textAlign: "center", marginTop: space.sm },
});
