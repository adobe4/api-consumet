import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Dimensions, Alert } from 'react-native';
import { useProject } from '../state/ProjectContext';
import { TransitionPreview } from '../components/TransitionPreview';
import { Btn, ChipRow, Label, Row } from '../components/Controls';
import { Slider } from '../components/Slider';
import { theme } from '../theme';
import { TRANSITIONS } from '../../engine';
import { DEFAULT_TRANSITION_PARAMS, type TransitionParams } from '../types';

const DIRECTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
] as const;

function useLoopProgress(periodMs = 1500): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      setP(((performance.now() - start) % periodMs) / periodMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [periodMs]);
  return p;
}

export function DesignerScreen() {
  const p = useProject();
  const progress = useLoopProgress();

  const [params, setParams] = useState<TransitionParams>(DEFAULT_TRANSITION_PARAMS);
  const [name, setName] = useState('My Transition');
  const [exportBase, setExportBase] = useState('fade');

  const set = (patch: Partial<TransitionParams>) => setParams((cur) => ({ ...cur, ...patch }));

  const screenW = Dimensions.get('window').width;
  const pw = screenW - 24;
  const ph = Math.min(pw * (16 / 9), Dimensions.get('window').height * 0.36);
  const cw = ph * (9 / 16);

  const canPreview = p.visuals.length >= 2;
  const fromUri = canPreview ? p.visuals[0].uri : '';
  const toUri = canPreview ? p.visuals[1].uri : '';

  function save() {
    const id = `custom-${Date.now()}`;
    p.addCustomTransition({ id, name: name.trim() || 'Custom', exportBase, params });
    Alert.alert('Saved', `“${name}” is now available in the Editor’s transition list.`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.preview, { width: pw, height: ph }]}>
        {canPreview ? (
          <View style={{ width: cw, height: ph }}>
            <TransitionPreview
              fromUri={fromUri}
              toUri={toUri}
              params={params}
              progress={progress}
              width={cw}
              height={ph}
            />
          </View>
        ) : (
          <Text style={styles.hint}>Add at least 2 visuals in the Editor to preview transitions live.</Text>
        )}
      </View>

      <Label>Name</Label>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={theme.muted} />

      <Label>Dissolve · {params.dissolve.toFixed(2)}</Label>
      <Slider value={params.dissolve} min={0} max={1} onChange={(v) => set({ dissolve: v })} />

      <Label>Slide · {params.slide.toFixed(2)}</Label>
      <Slider value={params.slide} min={0} max={1} onChange={(v) => set({ slide: v })} />

      <Label>Direction</Label>
      <ChipRow
        options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
        value={params.direction}
        onChange={(v) => set({ direction: v })}
      />

      <Label>Zoom punch · {params.zoom.toFixed(2)}</Label>
      <Slider value={params.zoom} min={0} max={1} onChange={(v) => set({ zoom: v })} />

      <Label>Twist · {Math.round(params.twist)}°</Label>
      <Slider value={params.twist} min={0} max={180} step={1} onChange={(v) => set({ twist: v })} />

      <Label>Edge softness · {params.softness.toFixed(2)}</Label>
      <Slider value={params.softness} min={0.01} max={1} onChange={(v) => set({ softness: v })} />

      <Label>Export style (used when rendering)</Label>
      <Text style={styles.note}>
        The live preview is exact. On export, the closest built-in ffmpeg transition below is used.
      </Text>
      <ChipRow
        options={TRANSITIONS.map((t) => ({ value: t.name, label: t.label }))}
        value={exportBase}
        onChange={setExportBase}
      />

      <View style={{ height: 16 }} />
      <Row gap={8}>
        <Btn label="Reset" onPress={() => setParams(DEFAULT_TRANSITION_PARAMS)} />
        <Btn label="Save transition" variant="primary" flex onPress={save} />
      </Row>

      {p.customTransitions.length > 0 && (
        <>
          <Label>Saved ({p.customTransitions.length})</Label>
          {p.customTransitions.map((c) => (
            <Text key={c.id} style={styles.saved}>★ {c.name}</Text>
          ))}
        </>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 12, paddingBottom: 24 },
  preview: {
    alignSelf: 'center',
    backgroundColor: '#000',
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  hint: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  note: { color: theme.muted, fontSize: 11, marginBottom: 8, lineHeight: 16 },
  input: {
    backgroundColor: theme.panel,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    padding: 10,
    fontSize: 14,
  },
  saved: { color: theme.text, fontSize: 13, paddingVertical: 4 },
});
