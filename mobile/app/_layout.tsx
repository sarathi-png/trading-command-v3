import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useSession } from "../src/state/session";
import { theme } from "../src/theme";

export default function RootLayout() {
  const restore = useSession((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontSize: 16, fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="order" options={{ presentation: "modal", title: "Order ticket" }} />
        <Stack.Screen name="pine" options={{ title: "Pine scripts" }} />
        <Stack.Screen name="journal" options={{ title: "Trade journal" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
