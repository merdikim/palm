/** Small shared UI primitives (plain, dark-friendly). */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { theme } from '../theme';

export function Card({ style, children, ...rest }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={theme.colors.textDim}
      style={styles.input}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
    />
  );
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const bg =
    variant === 'primary'
      ? theme.colors.primary
      : variant === 'danger'
        ? theme.colors.danger
        : 'transparent';
  const borderColor =
    variant === 'ghost' ? theme.colors.border : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.primaryText} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'ghost' && { color: theme.colors.text },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Row({ style, children, ...rest }: ViewProps) {
  return (
    <View style={[styles.row, style]} {...rest}>
      {children}
    </View>
  );
}

export function Pill({ text, tone = 'default' }: { text: string; tone?: 'default' | 'success' | 'danger' | 'warning' }) {
  const color =
    tone === 'success'
      ? theme.colors.success
      : tone === 'danger'
        ? theme.colors.danger
        : tone === 'warning'
          ? theme.colors.warning
          : theme.colors.textDim;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: theme.space(4),
    marginBottom: theme.space(3),
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: theme.space(3),
  },
  label: {
    color: theme.colors.textDim,
    fontSize: 13,
    marginBottom: theme.space(1),
  },
  muted: { color: theme.colors.textDim, fontSize: 13 },
  input: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(3),
    marginBottom: theme.space(3),
    fontSize: 16,
  },
  button: {
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(4),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space(2),
  },
  buttonText: {
    color: theme.colors.primaryText,
    fontSize: 16,
    fontWeight: '600',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: theme.space(2),
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 11, fontWeight: '600' },
});
