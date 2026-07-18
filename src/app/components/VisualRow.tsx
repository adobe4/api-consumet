import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import type { UIVisual } from '../types';
import { theme } from '../theme';

interface Props {
  visual: UIVisual;
  index: number;
  count: number;
  selected: boolean;
  hasOverrides: boolean;
  onSelect: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}

/**
 * Plain (non-animated) list row. Row-level entrance/exit/layout animations were
 * removed on purpose: Reanimated layout animations on Android crash hard when
 * several rows mount at once (exactly what a bulk import does).
 */
export function VisualRow({
  visual,
  index,
  count,
  selected,
  hasOverrides,
  onSelect,
  onUp,
  onDown,
  onRemove,
}: Props) {
  return (
    <Pressable onPress={onSelect} style={[styles.row, selected && styles.rowSelected]}>
      <Text style={[styles.idx, selected && { color: theme.accent }]}>{index + 1}</Text>
      {visual.kind === 'video' ? (
        <View style={styles.videoTile}>
          <Text style={styles.videoIcon}>▶</Text>
        </View>
      ) : (
        // resizeMethod="resize" decodes at thumbnail size instead of full
        // resolution — critical to avoid memory pressure with many photos.
        <Image
          source={{ uri: visual.uri }}
          style={styles.thumb}
          resizeMethod="resize"
          fadeDuration={0}
        />
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {visual.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.kind}>{visual.kind === 'video' ? 'clip' : 'image'}</Text>
          {hasOverrides && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>custom</Text>
            </View>
          )}
        </View>
      </View>
      <Pressable onPress={onUp} disabled={index === 0} style={styles.iconBtn} hitSlop={6}>
        <Text style={[styles.icon, index === 0 && styles.iconOff]}>▲</Text>
      </Pressable>
      <Pressable onPress={onDown} disabled={index === count - 1} style={styles.iconBtn} hitSlop={6}>
        <Text style={[styles.icon, index === count - 1 && styles.iconOff]}>▼</Text>
      </Pressable>
      <Pressable onPress={onRemove} style={styles.iconBtn} hitSlop={6}>
        <Text style={[styles.icon, styles.iconDanger]}>✕</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panel2,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 7,
    marginBottom: 7,
    gap: 9,
  },
  rowSelected: { borderColor: theme.accentBorder, backgroundColor: '#211a1c' },
  idx: { width: 20, textAlign: 'center', color: theme.muted, fontSize: 12, fontWeight: '800' },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.panel3 },
  videoTile: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: theme.panel3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIcon: { color: theme.accent, fontSize: 15 },
  info: { flex: 1 },
  name: { color: theme.text, fontSize: 13, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  kind: { color: theme.faint, fontSize: 11 },
  badge: {
    backgroundColor: theme.accentSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  badgeText: { color: theme.accent, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  iconBtn: { padding: 5 },
  icon: { color: theme.muted, fontSize: 13 },
  iconOff: { opacity: 0.25 },
  iconDanger: { color: theme.danger },
});
