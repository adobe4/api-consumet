import React from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ACCENT_GRADIENT, theme } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that springs down slightly while pressed — the app-wide feel. */
function useSpringPress() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPressIn = () => {
    scale.value = withSpring(0.96, { damping: 18, stiffness: 380 });
  };
  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 16, stiffness: 300 });
  };
  return { style, onPressIn, onPressOut };
}

export function Btn({
  label,
  onPress,
  variant = 'default',
  disabled,
  flex,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  flex?: boolean;
  small?: boolean;
}) {
  const press = useSpringPress();

  if (variant === 'primary') {
    return (
      <AnimatedPressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[press.style, flex && { flex: 1 }, disabled && styles.disabled]}
      >
        <LinearGradient
          colors={[...ACCENT_GRADIENT]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.btn, styles.btnPrimary, small && styles.btnSmall]}
        >
          <Text style={[styles.btnText, styles.btnTextPrimary, small && styles.btnTextSmall]}>
            {label}
          </Text>
        </LinearGradient>
      </AnimatedPressable>
    );
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        press.style,
        styles.btn,
        variant === 'danger' && styles.btnDanger,
        variant === 'ghost' && styles.btnGhost,
        small && styles.btnSmall,
        flex && { flex: 1 },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'danger' && { color: theme.danger },
          small && styles.btnTextSmall,
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
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
  const press = useSpringPress();
  const glow = useAnimatedStyle(
    () => ({
      borderColor: withTiming(active ? theme.accentBorder : theme.line, { duration: 180 }),
      backgroundColor: withTiming(active ? theme.accentSoft : theme.panel, { duration: 180 }),
    }),
    [active],
  );
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.chip, glow, press.style]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </AnimatedPressable>
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
  return (
    <View style={styles.labelRow}>
      <View style={styles.labelTick} />
      <Text style={styles.label}>{children}</Text>
    </View>
  );
}

export function Row({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

/** Elevated section card with a soft entrance animation. */
export function Card({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: object;
}) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(320).springify().damping(18)}
      style={[styles.card, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: theme.panel2,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: theme.radius - 4,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0, shadowColor: theme.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  btnDanger: { borderColor: '#3a2226', backgroundColor: '#1d1416' },
  btnGhost: { backgroundColor: 'transparent', borderColor: theme.line },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  disabled: { opacity: 0.4 },
  btnText: { color: theme.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  btnTextPrimary: { color: '#fff' },
  btnTextSmall: { fontSize: 12.5 },
  chip: {
    borderWidth: 1,
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 15,
    marginRight: 8,
  },
  chipText: { color: theme.muted, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: theme.text, fontWeight: '700' },
  chipRow: { paddingVertical: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9, marginTop: 2 },
  labelTick: { width: 3, height: 12, borderRadius: 2, backgroundColor: theme.accent },
  label: {
    color: theme.muted,
    fontSize: 11.5,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  row: { flexDirection: 'row' },
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.lineSoft,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 14,
    marginBottom: 12,
  },
});
