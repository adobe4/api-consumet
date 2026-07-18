import { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ProjectProvider } from './src/app/state/ProjectContext';
import { ErrorBoundary } from './src/app/components/ErrorBoundary';
import { ToastProvider } from './src/app/components/Toast';
import { EditorScreen } from './src/app/screens/EditorScreen';
import { DesignerScreen } from './src/app/screens/DesignerScreen';
import { theme } from './src/app/theme';

type Tab = 'editor' | 'designer';
const TABS: { key: Tab; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'designer', label: 'Transitions' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');
  const [tabsWidth, setTabsWidth] = useState(0);
  const pillX = useSharedValue(0);

  const tabWidth = tabsWidth / TABS.length;
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  const selectTab = (t: Tab, index: number) => {
    setTab(t);
    pillX.value = withSpring(index * tabWidth, { damping: 18, stiffness: 220 });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ProjectProvider>
          <ToastProvider>
            <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
              <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

              <View style={styles.header}>
                <View style={styles.brandRow}>
                  <Image source={require('./assets/logo.png')} style={styles.logo} />
                  <View>
                    <Text style={styles.brand}>Vinei</Text>
                    <Text style={styles.brandSub}>AUTO EDIT</Text>
                  </View>
                </View>

                <View
                  style={styles.tabs}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width - 6; // minus padding
                    setTabsWidth(w);
                    pillX.value = (tab === 'editor' ? 0 : 1) * (w / TABS.length);
                  }}
                >
                  {tabsWidth > 0 && (
                    <Animated.View style={[styles.pill, { width: tabWidth }, pillStyle]}>
                      <LinearGradient
                        colors={['#ff4d4f', '#c11f21']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.pillFill}
                      />
                    </Animated.View>
                  )}
                  {TABS.map((t, i) => (
                    <Pressable key={t.key} style={styles.tab} onPress={() => selectTab(t.key, i)}>
                      <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <LinearGradient
                colors={['rgba(239,43,45,0.55)', 'rgba(239,43,45,0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.hairline}
              />

              <View style={{ flex: 1 }}>
                {tab === 'editor' ? <EditorScreen /> : <DesignerScreen />}
              </View>
            </SafeAreaView>
          </ToastProvider>
          </ProjectProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 30, height: 30, resizeMode: 'contain' },
  brand: { color: theme.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.3, lineHeight: 20 },
  brandSub: { color: theme.accent, fontSize: 8.5, fontWeight: '800', letterSpacing: 2.4 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.panel,
    borderColor: theme.lineSoft,
    borderWidth: 1,
    borderRadius: 22,
    padding: 3,
    overflow: 'hidden',
  },
  pill: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 18, overflow: 'hidden' },
  pillFill: { flex: 1 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18 },
  tabText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '800' },
  hairline: { height: 1.5 },
});
