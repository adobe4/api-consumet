import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import type { UIVisual } from '../types';
import { theme } from '../theme';

interface Props {
  visual: UIVisual;
  index: number;
  count: number;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}

export function VisualRow({ visual, index, count, onUp, onDown, onRemove }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.idx}>{index + 1}</Text>
      <Image source={{ uri: visual.uri }} style={styles.thumb} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{visual.name}</Text>
        <Text style={styles.kind}>{visual.kind === 'video' ? '▶ clip' : '🖼 image'}</Text>
      </View>
      <Pressable onPress={onUp} disabled={index === 0} style={styles.iconBtn}>
        <Text style={[styles.icon, index === 0 && styles.iconOff]}>▲</Text>
      </Pressable>
      <Pressable onPress={onDown} disabled={index === count - 1} style={styles.iconBtn}>
        <Text style={[styles.icon, index === count - 1 && styles.iconOff]}>▼</Text>
      </Pressable>
      <Pressable onPress={onRemove} style={styles.iconBtn}>
        <Text style={[styles.icon, styles.iconDanger]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 6,
    marginBottom: 6,
    gap: 8,
  },
  idx: { width: 20, textAlign: 'center', color: theme.muted, fontSize: 12, fontWeight: '700' },
  thumb: { width: 42, height: 42, borderRadius: 6, backgroundColor: theme.panel2 },
  info: { flex: 1 },
  name: { color: theme.text, fontSize: 13 },
  kind: { color: theme.muted, fontSize: 11, marginTop: 2 },
  iconBtn: { padding: 6 },
  icon: { color: theme.muted, fontSize: 13 },
  iconOff: { opacity: 0.25 },
  iconDanger: { color: theme.danger },
});
