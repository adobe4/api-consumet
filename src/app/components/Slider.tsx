import { useRef, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { theme } from '../theme';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

/**
 * Smooth slider on react-native-gesture-handler: horizontal drags win over the
 * surrounding vertical scroll, taps jump, and the thumb tracks the finger.
 */
export function Slider({ value, min, max, step = 0, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const emit = (x: number) => {
    const w = widthRef.current || 1;
    const ratio = Math.min(1, Math.max(0, x / w));
    let v = min + ratio * (max - min);
    if (step > 0) v = Math.round(v / step) * step;
    onChange(v);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-6, 6])
    .onBegin((e) => runOnJS(emit)(e.x))
    .onUpdate((e) => runOnJS(emit)(e.x));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(emit)(e.x));
  const gesture = Gesture.Race(pan, tap);

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const fill = Math.min(1, Math.max(0, ratio)) * width;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.track} onLayout={onLayout}>
        <View style={styles.base} />
        <View style={[styles.fill, { width: fill }]} />
        <View style={[styles.thumb, { left: Math.max(0, fill - 9) }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 34,
    justifyContent: 'center',
  },
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 14,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.panel3,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 14,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  thumb: {
    position: 'absolute',
    top: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderColor: theme.accent,
  },
});
