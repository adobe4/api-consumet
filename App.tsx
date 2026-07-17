import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ProjectProvider } from './src/app/state/ProjectContext';
import { EditorScreen } from './src/app/screens/EditorScreen';
import { DesignerScreen } from './src/app/screens/DesignerScreen';
import { theme } from './src/app/theme';

type Tab = 'editor' | 'designer';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ProjectProvider>
          <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
            <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
            <View style={styles.header}>
              <Text style={styles.brand}>
                <Text style={{ color: theme.accent }}>◆ </Text>AutoReel
              </Text>
              <View style={styles.tabs}>
                <TabButton label="Editor" active={tab === 'editor'} onPress={() => setTab('editor')} />
                <TabButton label="Transitions" active={tab === 'designer'} onPress={() => setTab('designer')} />
              </View>
            </View>

            <View style={{ flex: 1 }}>
              {tab === 'editor' ? <EditorScreen /> : <DesignerScreen />}
            </View>
          </SafeAreaView>
        </ProjectProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
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
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  brand: { color: theme.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  tabs: { flexDirection: 'row', backgroundColor: theme.panel, borderRadius: 20, padding: 3 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18 },
  tabActive: { backgroundColor: theme.accent },
  tabText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
});
