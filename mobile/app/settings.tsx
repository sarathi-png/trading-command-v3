import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { api } from "../src/api/client";
import { Badge, Button, Card, Chip, ChipRow, Row, Screen, SectionTitle } from "../src/components/ui";
import { useSession } from "../src/state/session";
import { formatNumber, space, theme } from "../src/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const switchWorkspace = async (workspace: "paper" | "live") => {
    setBusy(true);
    setMessage(null);
    try {
      await session.setWorkspace(workspace);
      setMessage(`Now working in the ${workspace.toUpperCase()} workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not switch workspace.");
    } finally {
      setBusy(false);
    }
  };

  const changeDataSource = async (dataSource: "live" | "demo") => {
    setBusy(true);
    setMessage(null);
    try {
      await session.saveSettings({ dataSource });
      setMessage(
        dataSource === "demo"
          ? "Demo simulator data. No live prices."
          : "Live CoinDCX market data. A failed request is reported, never faked."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change the data source.");
    } finally {
      setBusy(false);
    }
  };

  const toggleLiveArming = async (armed: boolean) => {
    if (!armed) {
      try {
        await session.saveSettings({ liveArmed: false });
        setMessage("Live execution disarmed.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not disarm.");
      }
      return;
    }
    Alert.alert(
      "Arm live trading?",
      "Orders placed from this phone will be sent to CoinDCX and can lose real money. The server also requires LIVE_EXECUTION_ENABLED and valid credentials.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Arm",
          style: "destructive",
          onPress: async () => {
            try {
              await session.saveSettings({ liveArmed: true, confirm: "ARM-LIVE-TRADING" });
              setMessage("Live execution armed. Order entry is now possible from this device.");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not arm.");
            }
          },
        },
      ]
    );
  };

  const settings = session.settings;
  const system = session.system;
  const live = session.workspace === "live";

  return (
    <Screen scroll>
      <SectionTitle>Connection</SectionTitle>
      <Card>
        <Row label="Server" value={session.baseUrl || "—"} />
        <Row label="Session" value={session.status === "ready" ? "connected" : session.status} />
        <Row label="Version" value={system?.version ?? "—"} />
        <Row
          label="Market data"
          value={system?.exchangeMarket ?? "—"}
          valueColor={system?.exchangeMarket === "online" ? theme.up : theme.textDim}
        />
        <Row
          label="Private account"
          value={system?.exchangeAccount ?? "—"}
          valueColor={system?.exchangeAccount === "configured" ? theme.up : theme.textDim}
        />
      </Card>

      <SectionTitle>Workspace</SectionTitle>
      <Card>
        <Text style={styles.hint}>
          Paper and Live keep separate settings, risk limits and account views on the server.
          The app always states which one it is talking to.
        </Text>
        <ChipRow>
          <Chip
            label="Paper"
            active={!live}
            onPress={() => void switchWorkspace("paper")}
            disabled={busy}
          />
          <Chip
            label="Live"
            active={live}
            tone="down"
            onPress={() => void switchWorkspace("live")}
            disabled={busy}
          />
        </ChipRow>
        <Row label="Execution state" value={system?.execution ?? "—"} />
        <Row
          label="Live armed"
          value={system?.exchange?.liveExecutionEnabled ? (settings?.liveArmed ? "armed" : "not armed") : "disabled on server"}
          valueColor={settings?.liveArmed ? theme.down : theme.textDim}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Arm live execution from this device</Text>
          <Switch
            value={Boolean(settings?.liveArmed)}
            onValueChange={(value) => void toggleLiveArming(value)}
            disabled={!system?.exchange?.liveExecutionEnabled}
            trackColor={{ true: theme.down, false: theme.border }}
            thumbColor={theme.text}
          />
        </View>
        {live ? (
          <Text style={styles.warning}>
            The live workspace is selected. Order entry reaches CoinDCX.
          </Text>
        ) : null}
      </Card>

      <SectionTitle>Market data</SectionTitle>
      <Card>
        <Text style={styles.hint}>
          The demo simulator prints deterministic candles as time advances. Live mode reads
          CoinDCX and reports failures instead of inventing data.
        </Text>
        <ChipRow>
          <Chip
            label="Live"
            active={settings?.dataSource === "live"}
            onPress={() => void changeDataSource("live")}
            disabled={busy}
          />
          <Chip
            label="Demo"
            active={settings?.dataSource === "demo"}
            onPress={() => void changeDataSource("demo")}
            disabled={busy}
          />
        </ChipRow>
      </Card>

      {settings?.riskLimits ? (
        <>
          <SectionTitle>Risk limits</SectionTitle>
          <Card>
            <Row label="Max daily loss" value={formatNumber(settings.riskLimits.maxDailyLoss, 2)} />
            <Row label="Max order value" value={formatNumber(settings.riskLimits.maxOrderValue, 2)} />
            <Row label="Max leverage" value={`${settings.riskLimits.maxLeverage}x`} />
            <Row label="Max open positions" value={String(settings.riskLimits.maxOpenPositions)} />
            <Text style={styles.hint}>
              These live on the server and are enforced on every order, paper or live.
            </Text>
          </Card>
        </>
      ) : null}

      {message ? (
        <Card>
          <Text style={styles.message}>{message}</Text>
        </Card>
      ) : null}

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Button
          label="Sign out"
          variant="danger"
          onPress={async () => {
            await session.signOut();
            router.replace("/login");
          }}
        />
        <Text style={styles.hint}>
          The operator password is deleted from the device keystore when you sign out.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.textFaint, fontSize: 11, lineHeight: 16 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.sm,
    gap: space.md,
  },
  switchLabel: { color: theme.text, fontSize: 13, flex: 1 },
  warning: { color: theme.warn, fontSize: 11, lineHeight: 16 },
  message: { color: theme.textDim, fontSize: 12, lineHeight: 17 },
});
