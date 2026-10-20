import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { IntentProvider } from "@/src/state/intent";
import { SessionProvider } from "@/src/state/session";
import { SettingsProvider } from "@/src/state/settings";
import { SignalsProvider } from "@/src/state/signals";
import { WorkspaceProvider } from "@/src/state/workspace";
import { colors } from "@/src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <WorkspaceProvider>
          <SettingsProvider>
            <SignalsProvider>
              <IntentProvider>
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.bg },
                  }}
                />
              </IntentProvider>
            </SignalsProvider>
          </SettingsProvider>
        </WorkspaceProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
