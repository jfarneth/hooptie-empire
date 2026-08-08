import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';

/** Shared primitives so screens stay about the game, not about padding. */

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Dim({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.dim, style]}>{children}</Text>;
}

export function Money({
  value,
  format,
  style,
  colored = false,
}: {
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  colored?: boolean;
}) {
  const color = !colored
    ? theme.colors.text
    : value > 0
      ? theme.colors.money
      : value < 0
        ? theme.colors.danger
        : theme.colors.textDim;
  return <Text style={[styles.money, { color }, style]}>{format(value)}</Text>;
}

export type ButtonTone = 'default' | 'primary' | 'money' | 'danger' | 'ghost';

export function Button({
  label,
  sublabel,
  onPress,
  tone = 'default',
  disabled = false,
  style,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tones: Record<ButtonTone, { bg: string; fg: string; border: string }> = {
    default: { bg: theme.colors.surfaceHigh, fg: theme.colors.text, border: theme.colors.border },
    primary: { bg: theme.colors.accent, fg: '#1a1206', border: theme.colors.accent },
    money: { bg: theme.colors.money, fg: '#08210f', border: theme.colors.money },
    danger: { bg: theme.colors.dangerDim, fg: '#ffd9d2', border: theme.colors.danger },
    ghost: { bg: 'transparent', fg: theme.colors.textDim, border: theme.colors.border },
  };
  const t = tones[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: t.bg, borderColor: t.border },
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      <Text style={[styles.buttonLabel, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={[styles.buttonSub, { color: t.fg }]} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Chip({
  text,
  color = theme.colors.textDim,
  filled = false,
}: {
  text: string;
  color?: string;
  filled?: boolean;
}) {
  return (
    <View
      style={[
        styles.chip,
        { borderColor: color },
        filled && { backgroundColor: color },
      ]}
    >
      <Text style={[styles.chipText, { color: filled ? theme.colors.bg : color }]}>{text}</Text>
    </View>
  );
}

/** Thin horizontal progress bar, used for recon and note payoff. */
export function Meter({
  progress,
  color = theme.colors.accent,
  height = 4,
}: {
  progress: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.meterTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

export function Row({
  children,
  style,
  gap = 8,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Spacer({ h = 8 }: { h?: number }) {
  return <View style={{ height: h }} />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  label: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  body: { color: theme.colors.text, fontSize: 14 },
  dim: { color: theme.colors.textDim, fontSize: 12 },
  money: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  button: {
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.35 },
  buttonLabel: { fontSize: 13, fontWeight: '700' },
  buttonSub: { fontSize: 10, opacity: 0.8, marginTop: 1 },
  chip: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  meterTrack: {
    backgroundColor: theme.colors.surfaceHigh,
    overflow: 'hidden',
    width: '100%',
  },
  empty: { padding: 28, alignItems: 'center', gap: 6 },
  emptyTitle: { color: theme.colors.textDim, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  emptyHint: { color: theme.colors.textFaint, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
