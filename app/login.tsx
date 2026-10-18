import { useState } from "react";
import { Redirect } from "expo-router";
import {
  KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View,
} from "react-native";

import { Button, Card, Chip, ChipRow, Screen } from "../src/components/ui";
import { useSession } from "../src/state/session";
import { radius, space, theme } from "../src/theme";

export default function LoginScreen() {
  const status = useSession((state) => state.status);
  const signIn = useSession((state) => state.signIn);
  const savedUrl = useSession((state) => state.baseUrl);

  const [url, setUrl] = useState(savedUrl);
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState<"paper" | "live">("paper");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "ready") return <Redirect href="/(tabs)" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(url, password, workspace);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Trading Command</Text>
          <Text style={styles.subtitle}>
            The mobile client for your trading terminal. It talks to the same server the
            desktop app uses — no exchange credentials ever live on this phone.
          </Text>
        </View>

        <View style={styles.body}>
          <Card title="Server">
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://your-dashboard.example.com"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
            <Text style={styles.hint}>
              The address of the deployed Trading Command server (Vercel or your own host).
            </Text>
          </Card>

          <Card title="Operator password">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="API password"
              placeholderTextColor={theme.textFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Text style={styles.hint}>
              Stored in the device keystore. It is sent as a bearer token, exactly like a
              script would.
            </Text>
          </Card>

          <Card title="Workspace">
            <ChipRow>
              <Chip label="Paper" active={workspace === "paper"} onPress={() => setWorkspace("paper")} />
              <Chip
                label="Live"
                active={workspace === "live"}
                tone="down"
                onPress={() => setWorkspace("live")}
              />
            </ChipRow>
            <Text style={styles.hint}>
              {workspace === "paper"
                ? "Paper workspace: simulated orders and positions. Real money is never involved."
                : "Live workspace: order entry reaches CoinDCX. All the server's arming gates still apply."}
            </Text>
          </Card>

          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            label="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!url.trim() || !password}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.lg, gap: space.sm },
  title: { color: theme.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.textDim, fontSize: 13, lineHeight: 19 },
  body: { padding: space.lg, gap: space.md },
  input: {
    backgroundColor: theme.panelAlt,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    color: theme.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  hint: { color: theme.textFaint, fontSize: 11, lineHeight: 16 },
  error: {
    backgroundColor: theme.downSoft,
    borderRadius: radius.sm,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.down,
  },
  errorText: { color: theme.down, fontSize: 13 },
});
