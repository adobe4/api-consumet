import React from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView } from 'react-native';
import { theme } from '../theme';

export function Btn({
  label,
  onPress,
  variant = 'default',
  disabled,
  flex,
}: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'danger' && styles.btnDanger,
        flex && { flex: 1 },
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={[styles.btnText, variant === 'primary' && styles.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Horizontally scrollable single-select chip row. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} active={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Row({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: theme.panel2,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnDanger: { borderColor: '#3a2730' },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.8 },
  btnText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  btnTextPrimary: { color: '#fff' },
  chip: {
    backgroundColor: theme.panel,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.muted, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipRow: { paddingVertical: 2 },
  label: { color: theme.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 14 },
  row: { flexDirection: 'row' },
});
