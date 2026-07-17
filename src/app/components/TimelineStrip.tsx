import { useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet, type LayoutChangeEvent } from 'react-native';
import type { Timeline } from '../../engine/types';
import { SEGMENT_COLORS, theme } from '../theme';
import { fmtClock } from '../lib/format';

interface Props {
  timeline: Timeline;
  time: number;
  onSeek: (t: number) => void;
}

/** Proportional, tappable timeline strip with a draggable playhead. */
export function TimelineStrip({ timeline, time, onSeek }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const total = timeline.duration || 1;

  const seekAt = (x: number) => onSeek((Math.min(Math.max(0, x), widthRef.current) / (widthRef.current || 1)) * total);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekAt(e.nativeEvent.locationX),
      onPanResponderMove: (e) => seekAt(e.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const playheadX = Math.min(width, (time / total) * width);

  return (
    <View>
      <View style={styles.strip} onLayout={onLayout} {...responder.panHandlers}>
        {timeline.segments.map((s, i) => (
          <View
            key={s.index}
            style={{
              width: `${(s.duration / total) * 100}%`,
              backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={styles.segNum}>{s.index + 1}</Text>
          </View>
        ))}
        {width > 0 && <View style={[styles.playhead, { left: playheadX }]} pointerEvents="none" />}
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{fmtClock(time)}</Text>
        <Text style={styles.time}>{fmtClock(total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 34,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.line,
  },
  segNum: { color: '#fff', fontSize: 11, fontWeight: '700' },
  playhead: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2,
    backgroundColor: '#fff',
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
});
