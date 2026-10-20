import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import type { SignalRow } from "@/src/api/types";
import { formatAge, formatPrice } from "@/src/lib/format";
import { draftFromSignal } from "@/src/lib/intent";
import { signalLabel, signalTone } from "@/src/lib/status";
import { useIntent } from "@/src/state/intent";
import { useSignals } from "@/src/state/signals";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  MutedText,
  Screen,
  SectionTitle,
} from "@/src/ui/components";
import { colors, font, space } from "@/src/ui/theme";

export default function InboxScreen() {
  const { signals, loading, error, unread, refresh, markRead } = useSignals();
  const { setIntent } = useIntent();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  // Opening the inbox consumes the badge.
  useFocusEffect(
    useCallback(() => {
      markRead();
    }, [markRead])
  );

  async function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  function openTicket(signal: SignalRow) {
    const draft = draftFromSignal(signal);
    if (!draft) return;
    setIntent(draft);
    router.navigate("/(tabs)/trade");
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Inbox</Text>
          <Text style={styles.subtitle}>TradingView alerts · webhook validated</Text>
        </View>
        <Badge label={unread > 0 ? `${unread} NEW` : "CAUGHT UP"} tone={unread > 0 ? "warning" : "neutral"} />
      </View>

      <Card>
        <Text style={styles.cardTitle}>SIGNALS NEVER TRADE THEMSELVES</Text>
        <MutedText>
          Opening a signal only fills the paper ticket. You still review and confirm the order on the trade
          screen.
        </MutedText>
      </Card>

      <SectionTitle
        right={
          <Button
            label="Refresh"
            compact
            tone="neutral"
            busy={refreshing}
            onPress={() => void refreshNow()}
          />
        }
      >
        LATEST
      </SectionTitle>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {loading && signals.length === 0 ? <MutedText>Loading signals…</MutedText> : null}

      {!loading && signals.length === 0 && !error ? (
        <Card>
          <EmptyState
            title="No signals yet"
            detail="Alerts appear here after the webhook validates them. This screen does not invent setups."
          />
        </Card>
      ) : null}

      {signals.map((signal) => {
        const draft = draftFromSignal(signal);
        return (
          <Card key={signal.id}>
            <View style={styles.rowBetween}>
              <View style={styles.symbolRow}>
                <Text style={styles.symbol}>{signal.symbol}</Text>
                <Badge label={signalLabel(signal.status)} tone={signalTone(signal.status)} />
              </View>
              <Text style={styles.age}>{formatAge(signal.createdAt)}</Text>
            </View>

            <Text style={styles.meta}>
              {signal.timeframe} · {signal.strategy} · {signal.outcome.toLowerCase()}
            </Text>

            <View style={styles.priceRow}>
              <Text style={styles.mono}>price {formatPrice(signal.price)}</Text>
              <Text style={styles.mono}>entry {formatPrice(signal.entry)}</Text>
              <Text style={styles.mono}>stop {formatPrice(signal.stop)}</Text>
              <Text style={styles.mono}>target {formatPrice(signal.target)}</Text>
            </View>

            {signal.reasons.length > 0 ? (
              <Text style={styles.reason} numberOfLines={3}>
                {signal.reasons[0]}
              </Text>
            ) : null}

            {draft ? (
              <Button label="Open paper ticket" compact tone="accent" onPress={() => openTicket(signal)} />
            ) : (
              <MutedText>No directional ticket for {signalLabel(signal.status).toLowerCase()}.</MutedText>
            )}
          </Card>
        );
      })}

      <Text style={styles.footer}>
        Foreground polling every 15 s · no push notifications in v1. Nothing is auto-placed from a signal.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  headerText: { gap: 2, flex: 1 },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: colors.dim, fontSize: 11 },
  cardTitle: { color: colors.muted, fontSize: 12, letterSpacing: 1.6, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  symbolRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  symbol: { color: colors.text, fontSize: 16, fontWeight: "700", fontFamily: font.mono },
  age: { color: colors.dim, fontSize: 11 },
  meta: { color: colors.muted, fontSize: 11 },
  priceRow: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 2 },
  mono: { color: colors.muted, fontSize: 11, fontFamily: font.mono },
  reason: { color: colors.dim, fontSize: 11, lineHeight: 16, fontStyle: "italic" },
  footer: { color: colors.dim, fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: space.sm },
});
