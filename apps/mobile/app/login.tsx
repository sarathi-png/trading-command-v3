import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "@/src/api/config";
import { probeApiHealth } from "@/src/api/health";
import { errorText } from "@/src/state/api";
import { useSession } from "@/src/state/session";
import { Badge, Button, Field, MutedText } from "@/src/ui/components";
import { colors, radius, space } from "@/src/ui/theme";

export default function LoginScreen() {
  const { status, login } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ reachable: boolean; detail: string } | null>(null);

  useEffect(() => {
    let active = true;
    void probeApiHealth().then((probe) => {
      if (active) setHealth(probe);
    });
    return () => {
      active = false;
    };
  }, []);

  if (status === "signedIn") return <Redirect href="/(tabs)" />;

  async function submit() {
    if (busy) return;
    if (!password) {
      setError("Enter the operator password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brand}>TRADING COMMAND</Text>
          <Text style={styles.title}>Mobile workstation</Text>
          <Text style={styles.subtitle}>
            Read-only until you explicitly switch the server to PAPER. Live order entry is not offered in
            this build.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.healthRow}>
            <Badge
              label={health ? (health.reachable ? "API REACHABLE" : "API UNREACHABLE") : "CHECKING API"}
              tone={health ? (health.reachable ? "positive" : "warning") : "neutral"}
            />
            <Badge label="PAPER DEFAULT" tone="paper" />
          </View>
          <MutedText>{health?.detail ?? "Probing the API…"}</MutedText>

          <Field
            label="OPERATOR PASSWORD"
            value={password}
            onChangeText={setPassword}
            placeholder="API_PASSWORD"
            secureTextEntry
            hint="Used once for a 12 hour signed session. It is never stored on the device."
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button label="Sign in" onPress={() => void submit()} busy={busy} disabled={busy} />

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>API</Text>
            <Text style={styles.footerValue} numberOfLines={2}>
              {API_BASE_URL}
            </Text>
          </View>
        </View>

        <Text style={styles.note}>
          No exchange credentials are stored on this device. Orders are simulated by the server and require an
          explicit confirmation.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.xl },
  header: { gap: space.sm },
  brand: { color: colors.accent, fontSize: 11, letterSpacing: 3.5, fontWeight: "700" },
  title: { color: colors.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  healthRow: { flexDirection: "row", gap: space.sm },
  error: { color: colors.negative, fontSize: 12, lineHeight: 17 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm, gap: 2 },
  footerLabel: { color: colors.dim, fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  footerValue: { color: colors.muted, fontSize: 11, fontFamily: "Courier" },
  note: { color: colors.dim, fontSize: 11, lineHeight: 16, textAlign: "center" },
});
