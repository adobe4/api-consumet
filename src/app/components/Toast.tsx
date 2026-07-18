import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Text, StyleSheet, View, Animated, Easing } from 'react-native';
import { theme } from '../theme';

interface ToastState {
  id: number;
  message: string;
  kind: 'success' | 'info' | 'error';
}

interface ToastApi {
  show: (message: string, kind?: ToastState['kind']) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/**
 * App-wide toast. Uses React Native's built-in Animated (not Reanimated layout
 * animations) so it's stable on Android.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  const show = useCallback((message: string, kind: ToastState['kind'] = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    if (!toast) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [toast, anim]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <View style={styles.host} pointerEvents="none">
          <Animated.View
            style={[
              styles.toast,
              toast.kind === 'error' && styles.error,
              {
                opacity: anim,
                transform: [
                  { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                ],
              },
            ]}
          >
            <Text style={styles.icon}>
              {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : '•'}
            </Text>
            <Text style={styles.text} numberOfLines={3}>
              {toast.message}
            </Text>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '88%',
    backgroundColor: '#212530',
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 11,
    paddingHorizontal: 17,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  error: { borderColor: theme.accentBorder },
  icon: { color: theme.accent, fontSize: 14, fontWeight: '900' },
  text: { color: theme.text, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
});
