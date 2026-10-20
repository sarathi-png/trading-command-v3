import { Redirect, Tabs } from "expo-router";
import { useSession } from "@/src/state/session";
import { useSignals } from "@/src/state/signals";
import { colors } from "@/src/ui/theme";

export default function TabsLayout() {
  const { status } = useSession();
  const { unread } = useSignals();

  // A 401 or an expired token clears the session; the tab group must not stay
  // mounted behind a redirect to login.
  if (status === "loading") return null;
  if (status !== "signedIn") return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.dim,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "HOME" }} />
      <Tabs.Screen name="trade" options={{ title: "TRADE" }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "INBOX",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: colors.bg, fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
