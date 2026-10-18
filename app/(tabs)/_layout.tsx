import { StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: 16, fontWeight: "600" },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: theme.panel,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textFaint,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="chart"
        options={{
          title: "Chart",
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="markets"
        options={{
          title: "Markets",
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="positions"
        options={{
          title: "Positions",
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
