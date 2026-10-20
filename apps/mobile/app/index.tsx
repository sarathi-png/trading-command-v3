import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "@/src/state/session";
import { colors, space } from "@/src/ui/theme";

export default function Index() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>TRADING COMMAND</Text>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.hint}>Restoring session…</Text>
      </View>
    );
  }

  return <Redirect href={status === "signedIn" ? "/(tabs)" : "/login"} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, backgroundColor: colors.bg },
  brand: { color: colors.muted, fontSize: 12, letterSpacing: 3, fontWeight: "700" },
  hint: { color: colors.dim, fontSize: 12 },
});
