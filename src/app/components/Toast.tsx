import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
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

/** App-wide sliding toast — a premium replacement for Alert popups. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastState['kind'] = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <View style={styles.host} pointerEvents="none">
          <Animated.View
            key={toast.id}
            entering={FadeInDown.duration(260).springify().damping(17)}
            exiting={FadeOutDown.duration(200)}
            style={[
              styles.toast,
              toast.kind === 'error' && styles.error,
              toast.kind === 'info' && styles.info,
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
  info: {},
  icon: { color: theme.accent, fontSize: 14, fontWeight: '900' },
  text: { color: theme.text, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
});
