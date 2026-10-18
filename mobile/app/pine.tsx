import { useCallback, useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../src/api/client";
import { TIMEFRAMES, type Timeframe } from "../src/api/types";
import { Badge, Button, Card, Chip, ChipRow, Row, Screen, SectionTitle, SignedText } from "../src/components/ui";
import { runPine, toBars, type PineRunResult } from "../src/pine";
import { usePine } from "../src/state/pine";
import { formatNumber, signColor, space, theme } from "../src/theme";

export default function PineScreen() {
  const router = useRouter();

  const scripts = usePine((state) => state.scripts);
  const activeId = usePine((state) => state.activeId);
  const overrides = usePine((state) => state.overrides);
  const load = usePine((state) => state.load);
  const save = usePine((state) => state.save);
  const remove = usePine((state) => state.remove);
  const setActive = usePine((state) => state.setActive);
  const setOverride = usePine((state) => state.setOverride);
  const clearOverrides = usePine((state) => state.clearOverrides);

  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<PineRunResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the editor in step with the script that is active on the chart.
  useFocusEffect(
    useCallback(() => {
      const active = usePine.getState().active();
      if (active) {
        setDraft((current) => (current === active.source ? current : active.source));
        setDirty(false);
      }
    }, [])
  );

  const activeScript = scripts.find((script) => script.id === activeId) ?? null;

  const run = async () => {
    if (!activeScript) return;
    setRunning(true);
    try {
      const response = await api.candles(symbol, timeframe, 300);
      const output = runPine(activeScript.source, toBars(response.candles), {
        symbol,
        timeframe,
        inputOverrides: overrides[activeScript.id] ?? {},
      });
      setResult(output);
    } catch (error) {
      Alert.alert("Could not run", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const selectScript = async (id: string) => {
    await setActive(id);
    const script = usePine.getState().scripts.find((candidate) => candidate.id === id);
    if (script) {
      setDraft(script.source);
      setDirty(false);
    }
  };

  const persist = async () => {
    if (!activeScript) return;
    await save({ ...activeScript, source: draft, updatedAt: Date.now() });
    setDirty(false);
    await run();
  };

  const createScript = async () => {
    const id = `script-${Date.now()}`;
    const script = {
      id,
      name: `Script ${scripts.length + 1}`,
      source: `//@version=5
indicator("My script", overlay=true)

length = input.int(20, "Length")
average = ta.sma(close, length)
plot(average, "Average")
`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await save(script);
    setDraft(script.source);
    setDirty(false);
  };

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, "The script is removed from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void remove(id),
      },
    ]);
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Paste a TradingView Pine Script. It runs on this phone against live candles, its
            plots are drawn on the chart, and a strategy script is backtested with the same
            engine the desktop terminal uses.
          </Text>

          <SectionTitle
            right={
              <Pressable onPress={() => void createScript()} hitSlop={8}>
                <Text style={styles.link}>+ New script</Text>
              </Pressable>
            }
          >
            Saved scripts
          </SectionTitle>
          <ChipRow>
            {scripts.map((script) => (
              <Chip
                key={script.id}
                label={script.name}
                active={script.id === activeId}
                onPress={() => void selectScript(script.id)}
              />
            ))}
          </ChipRow>

          {activeScript ? (
            <Card>
              <View style={styles.scriptHead}>
                <Text style={styles.scriptName}>{activeScript.name}</Text>
                <Pressable
                  onPress={() => confirmDelete(activeScript.id, activeScript.name)}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.down} />
                </Pressable>
              </View>
              <TextInput
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  setDirty(true);
                }}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                style={styles.editor}
                placeholder="// paste your Pine Script here"
                placeholderTextColor={theme.textFaint}
              />
              <View style={styles.editorActions}>
                <Button
                  label={dirty ? "Save & run" : "Run"}
                  onPress={() => void (dirty ? persist() : run())}
                  loading={running}
                />
                {dirty ? (
                  <Button
                    label="Discard"
                    variant="ghost"
                    onPress={() => {
                      setDraft(activeScript.source);
                      setDirty(false);
                    }}
                  />
                ) : null}
              </View>
            </Card>
          ) : null}

          <SectionTitle>Run against</SectionTitle>
          <ChipRow>
            {["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"].map((candidate) => (
              <Chip
                key={candidate}
                label={candidate}
                active={candidate === symbol}
                onPress={() => setSymbol(candidate)}
              />
            ))}
          </ChipRow>
          <ChipRow>
            {TIMEFRAMES.slice(0, 6).map((candidate) => (
              <Chip
                key={candidate}
                label={candidate}
                active={candidate === timeframe}
                onPress={() => setTimeframe(candidate)}
              />
            ))}
          </ChipRow>

          {result ? (
            <>
              <SectionTitle
                right={
                  <Pressable onPress={() => router.push({ pathname: "/(tabs)/chart" })} hitSlop={8}>
                    <Text style={styles.link}>View on chart</Text>
                  </Pressable>
                }
              >
                Result
              </SectionTitle>
              <Card>
                <View style={styles.statusRow}>
                  <Badge
                    label={result.ok ? "RAN" : "ERRORS"}
                    tone={result.ok ? "up" : "down"}
                  />
                  <Text style={styles.statusMeta}>
                    {result.meta.title} · {result.barCount} bars · {result.meta.type}
                  </Text>
                </View>

                {result.errors.map((error, index) => (
                  <Text key={index} style={styles.errorText}>
                    {error.message}
                  </Text>
                ))}
                {result.warnings.map((warning, index) => (
                  <Text key={index} style={styles.warningText}>
                    ! {warning}
                  </Text>
                ))}

                {result.inputs.length ? (
                  <>
                    <Text style={styles.subTitle}>Inputs</Text>
                    {result.inputs.map((input) => (
                      <View key={input.id} style={styles.inputRow}>
                        <Text style={styles.inputLabel}>{input.title}</Text>
                        <View style={styles.inputControls}>
                          {input.type === "bool" ? (
                            <Chip
                              label={String(input.value)}
                              active={Boolean(input.value)}
                              onPress={() =>
                                void setOverride(
                                  activeScript?.id ?? "",
                                  input.id,
                                  !input.value
                                )
                              }
                            />
                          ) : input.type === "int" || input.type === "float" ? (
                            <TextInput
                              value={String(input.value)}
                              onChangeText={(text) => {
                                const parsed = Number(text);
                                void setOverride(
                                  activeScript?.id ?? "",
                                  input.id,
                                  Number.isFinite(parsed) ? parsed : input.value
                                );
                              }}
                              keyboardType="numeric"
                              style={styles.numberInput}
                            />
                          ) : (
                            <Text style={styles.inputValue}>{String(input.value)}</Text>
                          )}
                        </View>
                      </View>
                    ))}
                    <Button
                      label="Reset inputs"
                      variant="ghost"
                      onPress={() => void clearOverrides(activeScript?.id ?? "")}
                    />
                  </>
                ) : null}

                {result.plots.length ? (
                  <>
                    <Text style={styles.subTitle}>Plots</Text>
                    {result.plots.map((plot) => (
                      <Row
                        key={plot.title}
                        label={plot.title}
                        value={`${plot.points.length} points`}
                      />
                    ))}
                  </>
                ) : null}

                {result.trades.length ? (
                  <>
                    <Text style={styles.subTitle}>Backtest</Text>
                    <Row label="Trades" value={String(result.stats?.totalTrades ?? 0)} />
                    <Row
                      label="Net profit"
                      value={formatNumber(result.stats?.netProfit ?? 0, 2)}
                      valueColor={signColor(result.stats?.netProfit)}
                    />
                    <Row label="Win rate" value={`${(result.stats?.winRate ?? 0).toFixed(0)}%`} />
                    <Row label="Max drawdown" value={formatNumber(result.stats?.maxDrawdown ?? 0, 2)} />
                    {result.trades.slice(-5).map((trade) => (
                      <Row
                        key={trade.id}
                        label={`${trade.direction} ${trade.id}`}
                        value={`${formatNumber(trade.entryPrice, 2)} → ${
                          trade.exitPrice ? formatNumber(trade.exitPrice, 2) : "open"
                        }`}
                        valueColor={signColor(trade.netProfit)}
                      />
                    ))}
                  </>
                ) : null}

                {result.alerts.length ? (
                  <>
                    <Text style={styles.subTitle}>Alerts (latest)</Text>
                    {result.alerts.slice(-5).map((alert, index) => (
                      <Text key={index} style={styles.alertText}>
                        {alert.message}
                      </Text>
                    ))}
                  </>
                ) : null}
              </Card>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  intro: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  link: { color: theme.accent, fontSize: 12, fontWeight: "600" },
  scriptHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scriptName: { color: theme.text, fontSize: 14, fontWeight: "700" },
  editor: {
    backgroundColor: theme.bg,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    color: theme.text,
    padding: space.md,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
    minHeight: 220,
    textAlignVertical: "top",
  },
  editorActions: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statusMeta: { color: theme.textDim, fontSize: 11 },
  errorText: { color: theme.down, fontSize: 12, lineHeight: 17 },
  warningText: { color: theme.warn, fontSize: 11, lineHeight: 16 },
  subTitle: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: space.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    gap: space.md,
  },
  inputLabel: { color: theme.text, fontSize: 12, flex: 1 },
  inputControls: { flexDirection: "row", alignItems: "center" },
  inputValue: { color: theme.textDim, fontSize: 12 },
  numberInput: {
    backgroundColor: theme.bg,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    color: theme.text,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    fontSize: 13,
    minWidth: 76,
    textAlign: "right",
  },
  alertText: { color: theme.warn, fontSize: 11, lineHeight: 16 },
});
