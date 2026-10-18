import { StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Badge, Card, Row, Screen, SectionTitle } from "../../src/components/ui";
import { useSession } from "../../src/state/session";
import { space, theme } from "../../src/theme";

const LINKS: Array<{
  href: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    href: "/pine",
    title: "Pine scripts",
    description: "Paste a Pine script, run it on live candles, draw it on the chart.",
    icon: "code-slash-outline",
  },
  {
    href: "/journal",
    title: "Trade journal",
    description: "Every closed trade, with the reason it was taken.",
    icon: "book-outline",
  },
  {
    href: "/settings",
    title: "Settings",
    description: "Workspace, risk limits, data source and live arming.",
    icon: "settings-outline",
  },
];

export default function MoreScreen() {
  const router = useRouter();
  const workspace = useSession((state) => state.workspace);
  const system = useSession((state) => state.system);
  const settings = useSession((state) => state.settings);

  return (
    <Screen scroll>
      <SectionTitle>Tools</SectionTitle>
      <Card>
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} asChild>
            <View style={styles.linkRow}>
              <Ionicons name={link.icon} size={20} color={theme.accent} />
              <View style={styles.linkText}>
                <Text style={styles.linkTitle}>{link.title}</Text>
                <Text style={styles.linkDescription}>{link.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textFaint} />
            </View>
          </Link>
        ))}
      </Card>

      <SectionTitle>Deployment</SectionTitle>
      <Card>
        <Row label="Workspace" value={workspace.toUpperCase()} />
        <Row label="Execution" value={system?.execution ?? "—"} />
        <Row label="Data source" value={settings?.dataSource === "demo" ? "demo simulator" : "CoinDCX live"} />
        <Row label="Market data" value={system?.exchangeMarket ?? "—"} />
        <Row label="Private account" value={system?.exchangeAccount ?? "—"} />
        <Row label="Server" value={system?.version ?? "—"} />
      </Card>

      <Card>
        <Text style={styles.note}>
          This app is a client of the same server as the desktop terminal. It holds the operator
          password in the device keystore and never stores exchange credentials, so it can be
          revoked from the server at any time.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  linkText: { flex: 1 },
  linkTitle: { color: theme.text, fontSize: 14, fontWeight: "600" },
  linkDescription: { color: theme.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  note: { color: theme.textFaint, fontSize: 11, lineHeight: 17 },
});
