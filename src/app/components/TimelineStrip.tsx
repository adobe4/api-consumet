import { useRef, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { Timeline } from '../../engine/types';
import { SEGMENT_COLORS, theme } from '../theme';
import { fmtClock } from '../lib/format';

interface Props {
  timeline: Timeline;
  time: number;
  onSeek: (t: number) => void;
  onScrubStart?: () => void;
}

/**
 * Proportional, tappable timeline with a smooth draggable playhead. Uses
 * react-native-gesture-handler so drags don't fight the vertical scroll and
 * stay responsive.
 */
export function TimelineStrip({ timeline, time, onSeek, onScrubStart }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const total = timeline.duration || 1;

  const seekAt = (x: number) => {
    const w = widthRef.current || 1;
    const clamped = Math.min(Math.max(0, x), w);
    onSeek((clamped / w) * total);
  };
  const begin = (x: number) => {
    onScrubStart?.();
    seekAt(x);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-6, 6])
    .onBegin((e) => runOnJS(begin)(e.x))
    .onUpdate((e) => runOnJS(seekAt)(e.x));
  const tap = Gesture.Tap().onEnd((e) => {
    runOnJS(onScrubStart ?? (() => {}))();
    runOnJS(seekAt)(e.x);
  });
  const gesture = Gesture.Race(pan, tap);

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const playheadX = Math.min(width, (time / total) * width);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View style={styles.hit}>
          <View style={styles.strip} onLayout={onLayout}>
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
          </View>
          {width > 0 && (
            <View style={[styles.playhead, { left: playheadX - 1 }]} pointerEvents="none">
              <View style={styles.knob} />
            </View>
          )}
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text style={styles.time}>{fmtClock(time)}</Text>
        <Text style={styles.time}>{fmtClock(total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { paddingVertical: 10, justifyContent: 'center' },
  strip: {
    height: 40,
    flexDirection: 'row',
    borderRadius: 9,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.line,
  },
  segNum: { color: '#fff', fontSize: 11, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 2 },
  playhead: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  knob: {
    position: 'absolute',
    top: -7,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: theme.accent,
    marginLeft: -7,
    left: 1,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
});
