import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, font, radius, space } from "./theme";

export type Tone = "neutral" | "accent" | "positive" | "negative" | "warning" | "paper" | "live";

const toneColor: Record<Tone, string> = {
  neutral: colors.muted,
  accent: colors.accent,
  positive: colors.positive,
  negative: colors.negative,
  warning: colors.warning,
  paper: colors.paper,
  live: colors.live,
};

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={[styles.safe, style]} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.scrollContent}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const color = toneColor[tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  busy,
  tone = "accent",
  compact,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: Tone;
  compact?: boolean;
}) {
  const color = toneColor[tone];
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(blocked), busy: Boolean(busy) }}
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { borderColor: color, opacity: blocked ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={styles.input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, tone ? { color: toneColor[tone] } : null]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function MutedText({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Paper/Live selector. Paper is the default and is never hidden. */
export function WorkspaceSwitch({
  value,
  onChange,
}: {
  value: "paper" | "live";
  onChange: (next: "paper" | "live") => void;
}) {
  return (
    <View style={styles.segment}>
      {(["paper", "live"] as const).map((option) => {
        const active = value === option;
        const color = option === "paper" ? colors.paper : colors.live;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            style={[styles.segmentItem, active && { borderColor: color, backgroundColor: colors.surfaceAlt }]}
          >
            <Text style={[styles.segmentText, { color: active ? color : colors.dim }]}>
              {option.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SideSwitch({ value, onChange }: { value: "buy" | "sell"; onChange: (next: "buy" | "sell") => void }) {
  return (
    <View style={styles.segment}>
      {(["buy", "sell"] as const).map((option) => {
        const active = value === option;
        const color = option === "buy" ? colors.positive : colors.negative;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            style={[styles.segmentItem, active && { borderColor: color, backgroundColor: colors.surfaceAlt }]}
          >
            <Text style={[styles.segmentText, { color: active ? color : colors.dim }]}>{option.toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm },
  sectionTitle: { color: colors.muted, fontSize: 12, letterSpacing: 1.6, fontWeight: "700" },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  buttonCompact: { minHeight: 32, paddingHorizontal: space.md },
  buttonText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.6 },
  buttonTextCompact: { fontSize: 12 },
  field: { gap: space.xs },
  fieldLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: font.mono,
  },
  hint: { color: colors.dim, fontSize: 11 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 3 },
  kvLabel: { color: colors.muted, fontSize: 12, flexShrink: 0 },
  kvValue: { color: colors.text, fontSize: 12, fontFamily: font.mono, textAlign: "right", flex: 1 },
  empty: { paddingVertical: space.xl, alignItems: "center", gap: space.sm },
  emptyTitle: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  emptyDetail: { color: colors.dim, fontSize: 12, textAlign: "center" },
  error: { color: colors.negative, fontSize: 12, lineHeight: 17 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.sm },
  segment: { flexDirection: "row", gap: space.sm },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
});
