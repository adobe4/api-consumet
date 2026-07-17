import { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { theme } from '../theme';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

/**
 * Lightweight slider built on PanResponder (no extra native module). Used for
 * all the designer parameter controls and the transition-duration control.
 */
export function Slider({ value, min, max, step = 0, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const emit = (ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    let v = min + clamped * (max - min);
    if (step > 0) v = Math.round(v / step) * step;
    onChange(v);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => emit(e.nativeEvent.locationX / (widthRef.current || 1)),
      onPanResponderMove: (e) => emit(e.nativeEvent.locationX / (widthRef.current || 1)),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const fill = Math.min(1, Math.max(0, ratio)) * width;

  return (
    <View style={styles.track} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.base} />
      <View style={[styles.fill, { width: fill }]} />
      <View style={[styles.thumb, { left: Math.max(0, fill - 9) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 30,
    justifyContent: 'center',
  },
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 12,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.panel2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 12,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  thumb: {
    position: 'absolute',
    top: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: theme.accent,
  },
});
