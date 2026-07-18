import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, Dimensions } from 'react-native';
import { useProject } from '../state/ProjectContext';
import { TransitionPreview } from '../components/TransitionPreview';
import { Btn, Card, ChipRow, Label, Row } from '../components/Controls';
import { Slider } from '../components/Slider';
import { useToast } from '../components/Toast';
import { theme } from '../theme';
import { TRANSITIONS } from '../../engine';
import { BUILTIN_TRANSITION_PARAMS } from '../preview/transitionShader';
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
  const toast = useToast();
  const progress = useLoopProgress();

  const [params, setParams] = useState<TransitionParams>(DEFAULT_TRANSITION_PARAMS);
  const [name, setName] = useState('My Transition');
  const [exportBase, setExportBase] = useState('fade');
  const [preset, setPreset] = useState('fade');

  const set = (patch: Partial<TransitionParams>) => setParams((cur) => ({ ...cur, ...patch }));

  const screenW = Dimensions.get('window').width;
  const pw = screenW - 24;
  const ph = Math.min(pw * (16 / 9), Dimensions.get('window').height * 0.34);
  const cw = ph * (9 / 16);

  const canPreview = p.visuals.length >= 2;
  const fromUri = canPreview ? p.visuals[0].uri : '';
  const toUri = canPreview ? p.visuals[1].uri : '';

  function applyPreset(key: string) {
    const b = BUILTIN_TRANSITION_PARAMS[key];
    if (!b) return;
    setPreset(key);
    setParams(b.params);
    setExportBase(b.exportBase);
  }

  function save() {
    const id = `custom-${Date.now()}`;
    p.addCustomTransition({ id, name: name.trim() || 'Custom', exportBase, params });
    toast.show(`“${name}” saved — pick it in the Editor`);
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

      <Card delay={40}>
        <Label>Start from a preset</Label>
        <ChipRow
          options={Object.keys(BUILTIN_TRANSITION_PARAMS).map((k) => ({
            value: k,
            label: k.charAt(0).toUpperCase() + k.slice(1),
          }))}
          value={preset}
          onChange={applyPreset}
        />
      </Card>

      <Card delay={80}>
        <Label>Design</Label>
        <Text style={styles.param}>Dissolve · {params.dissolve.toFixed(2)}</Text>
        <Slider value={params.dissolve} min={0} max={1} onChange={(v) => set({ dissolve: v })} />

        <Text style={styles.param}>Slide · {params.slide.toFixed(2)}</Text>
        <Slider value={params.slide} min={0} max={1} onChange={(v) => set({ slide: v })} />

        <Text style={styles.param}>Direction</Text>
        <ChipRow
          options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
          value={params.direction}
          onChange={(v) => set({ direction: v })}
        />

        <Text style={styles.param}>Zoom punch · {params.zoom.toFixed(2)}</Text>
        <Slider value={params.zoom} min={0} max={1} onChange={(v) => set({ zoom: v })} />

        <Text style={styles.param}>Twist · {Math.round(params.twist)}°</Text>
        <Slider value={params.twist} min={0} max={180} step={1} onChange={(v) => set({ twist: v })} />

        <Text style={styles.param}>Edge softness · {params.softness.toFixed(2)}</Text>
        <Slider value={params.softness} min={0.01} max={1} onChange={(v) => set({ softness: v })} />
      </Card>

      <Card delay={120}>
        <Label>Save</Label>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Transition name"
          placeholderTextColor={theme.faint}
        />
        <Text style={styles.note}>
          The live preview is exact. On export, the closest built-in ffmpeg style below is used.
        </Text>
        <ChipRow
          options={TRANSITIONS.map((t) => ({ value: t.name, label: t.label }))}
          value={exportBase}
          onChange={setExportBase}
        />
        <View style={{ height: 12 }} />
        <Row gap={8}>
          <Btn label="Reset" onPress={() => setParams(DEFAULT_TRANSITION_PARAMS)} />
          <Btn label="Save transition" variant="primary" flex onPress={save} />
        </Row>
      </Card>

      {p.customTransitions.length > 0 && (
        <Card delay={160}>
          <Label>Saved ({p.customTransitions.length})</Label>
          {p.customTransitions.map((c) => (
            <View key={c.id} style={styles.savedRow}>
              <Text style={styles.savedName}>★ {c.name}</Text>
              <Text style={styles.savedBase}>{c.exportBase}</Text>
              <Pressable
                onPress={() => {
                  p.removeCustomTransition(c.id);
                  toast.show(`“${c.name}” removed`, 'info');
                }}
                hitSlop={8}
              >
                <Text style={styles.savedRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 12, paddingBottom: 24 },
  preview: {
    alignSelf: 'center',
    backgroundColor: '#000',
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  hint: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  note: { color: theme.muted, fontSize: 11, marginVertical: 8, lineHeight: 16 },
  param: { color: theme.muted, fontSize: 12, marginTop: 10, marginBottom: 2, fontWeight: '600' },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    padding: 11,
    fontSize: 14,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.lineSoft,
  },
  savedName: { color: theme.text, fontSize: 13.5, fontWeight: '600', flex: 1 },
  savedBase: { color: theme.faint, fontSize: 11.5 },
  savedRemove: { color: theme.danger, fontSize: 13 },
});
