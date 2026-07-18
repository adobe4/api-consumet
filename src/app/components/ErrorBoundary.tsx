import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { clearProject } from '../state/persistence';
import { theme } from '../theme';

interface State {
  error: Error | null;
}

type FatalListener = (error: Error) => void;
let fatalListener: FatalListener | null = null;
let handlerInstalled = false;

/**
 * Route fatal JS errors (which would hard-crash a release build) into the
 * boundary's recovery screen instead. Non-fatal errors keep default handling.
 */
function installGlobalHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  const ErrorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: Error, isFatal?: boolean) => void; setGlobalHandler: (h: (e: Error, isFatal?: boolean) => void) => void } }).ErrorUtils;
  if (!ErrorUtils) return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal && fatalListener) {
      fatalListener(error instanceof Error ? error : new Error(String(error)));
      return; // swallowed: recovery screen takes over instead of a crash
    }
    previous?.(error, isFatal);
  });
}

/**
 * Catches render errors AND fatal runtime errors, showing a branded recovery
 * screen with "try again" and a reset-project escape hatch (in case persisted
 * state is what keeps crashing).
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidMount(): void {
    installGlobalHandler();
    fatalListener = (error) => this.setState({ error });
  }

  componentWillUnmount(): void {
    fatalListener = null;
  }

  private retry = () => this.setState({ error: null });

  private resetProject = async () => {
    await clearProject();
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.screen}>
        <Image source={require('../../../assets/logo.png')} style={styles.logo} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message} numberOfLines={4}>
          {this.state.error.message}
        </Text>
        <Pressable style={styles.primary} onPress={this.retry}>
          <Text style={styles.primaryText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={this.resetProject}>
          <Text style={styles.secondaryText}>Reset project data & retry</Text>
        </Pressable>
        <Text style={styles.note}>
          Resetting clears the saved project (audio, visuals, settings) but keeps the app installed.
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  logo: { width: 54, height: 54, resizeMode: 'contain', marginBottom: 6 },
  title: { color: theme.text, fontSize: 19, fontWeight: '800' },
  message: { color: theme.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 34,
    marginTop: 10,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: {
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  secondaryText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  note: { color: theme.faint, fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16 },
});
