/**
 * Shared UI primitives.
 *
 * The phone app reuses the desktop app's visual language: dark surfaces,
 * one accent colour, a strict gain/loss convention, and explicit labelling
 * (no unexplained abbreviations).
 */
import { type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radius, signColor, space, theme } from "../theme";

export function Screen({
  children,
  scroll = false,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement;
}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.flex}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {content}
    </SafeAreaView>
  );
}

export function Card({
  children,
  title,
  right,
  style,
}: {
  children?: ReactNode;
  title?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {(title || right) && (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Row({
  label,
  value,
  valueColor,
  mono = true,
  hint,
}: {
  label: string;
  value: ReactNode;
  valueColor?: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.rowValue, mono && styles.mono, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

export function StatTile({
  label,
  value,
  color,
  caption,
}: {
  label: string;
  value: string;
  color?: string;
  caption?: string;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? <Text style={styles.tileCaption}>{caption}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: "up" | "down" | "warn";
  disabled?: boolean;
}) {
  const activeColor =
    tone === "up" ? theme.up : tone === "down" ? theme.down : tone === "warn" ? theme.warn : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: theme.chipActive, borderColor: activeColor },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          active && { color: tone ? activeColor : "#ffffff" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {children}
    </ScrollView>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const background =
    variant === "primary"
      ? theme.accent
      : variant === "danger"
        ? theme.down
        : variant === "secondary"
          ? theme.panelAlt
          : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        variant === "ghost" && styles.buttonGhost,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={[styles.buttonText, variant === "ghost" && { color: theme.textDim }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Badge({ label, tone }: { label: string; tone: "up" | "down" | "warn" | "muted" | "accent" }) {
  const color =
    tone === "up"
      ? theme.up
      : tone === "down"
        ? theme.down
        : tone === "warn"
          ? theme.warn
          : tone === "accent"
            ? theme.accent
            : theme.textDim;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={theme.accent} />
      {label ? <Text style={styles.emptyMessage}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Could not load"
      message={message}
      action={onRetry ? <Button label="Retry" onPress={onRetry} variant="secondary" /> : undefined}
    />
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A signed number, coloured by direction. */
export function SignedText({
  value,
  format,
  style,
}: {
  value: number | null | undefined;
  format: (value: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <Text style={[styles.signed, style]}>—</Text>;
  }
  return <Text style={[styles.signed, { color: signColor(value) }, style]}>{format(value)}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scrollContent: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.md },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: space.lg,
    gap: space.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
  cardTitle: { color: theme.text, fontSize: 14, fontWeight: "600", letterSpacing: 0.3 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 3,
    gap: space.md,
  },
  rowLabelWrap: { flexShrink: 1 },
  rowLabel: { color: theme.textDim, fontSize: 13 },
  rowHint: { color: theme.textFaint, fontSize: 11 },
  rowValue: { color: theme.text, fontSize: 13, textAlign: "right" },
  mono: { fontFamily: "monospace" },
  tile: {
    flex: 1,
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: space.md,
    gap: 2,
  },
  tileLabel: { color: theme.textDim, fontSize: 11, letterSpacing: 0.4 },
  tileValue: { color: theme.text, fontSize: 19, fontWeight: "700" },
  tileCaption: { color: theme.textFaint, fontSize: 10 },
  chipRow: { gap: space.sm, paddingVertical: 2, paddingRight: space.lg },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: theme.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  chipText: { color: theme.textDim, fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  button: {
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonGhost: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sm,
  },
  sectionTitle: { color: theme.textDim, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase" },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  empty: { alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  emptyTitle: { color: theme.text, fontSize: 15, fontWeight: "600" },
  emptyMessage: { color: theme.textDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
  emptyAction: { marginTop: space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: space.sm },
  signed: { color: theme.textDim, fontSize: 13, fontWeight: "600" },
});
