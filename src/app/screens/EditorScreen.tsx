import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import { useProject } from '../state/ProjectContext';
import { usePlayhead } from '../preview/usePlayhead';
import { PreviewCanvas } from '../preview/PreviewCanvas';
import { TimelineStrip } from '../components/TimelineStrip';
import { VisualRow } from '../components/VisualRow';
import { Btn, ChipRow, Label, Row } from '../components/Controls';
import { Slider } from '../components/Slider';
import { pickAudio, pickVisuals } from '../lib/pickers';
import { exportVideo } from '../native/export';
import { BUILTIN_TRANSITION_PARAMS } from '../preview/transitionShader';
import { theme } from '../theme';
import type { AnimationKind } from '../../engine/types';

const ANIMATIONS: { value: AnimationKind; label: string }[] = [
  { value: 'ken-burns', label: 'Ken Burns' },
  { value: 'zoom-in', label: 'Zoom In' },
  { value: 'zoom-out', label: 'Zoom Out' },
  { value: 'zoom-in-out', label: 'Zoom In/Out' },
  { value: 'pan-left', label: 'Pan Left' },
  { value: 'pan-right', label: 'Pan Right' },
  { value: 'random', label: 'Random' },
  { value: 'none', label: 'None' },
];

const QUALITIES = [
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
  { value: 'prores', label: 'ProRes' },
] as const;

export function EditorScreen() {
  const p = useProject();
  const { time, playing, toggle, seek } = usePlayhead(p.audio?.uri ?? null, p.timeline.duration);

  const screenW = Dimensions.get('window').width;
  const previewW = screenW - 24;
  // Fit the project aspect ratio, capped so controls stay reachable.
  const aspect = p.settings.height / p.settings.width;
  const previewH = Math.min(previewW * aspect, Dimensions.get('window').height * 0.42);
  const canvasW = previewH / aspect;

  const transitionOptions = useMemo(() => {
    const builtins = Object.keys(BUILTIN_TRANSITION_PARAMS).map((k) => ({ value: k, label: cap(k) }));
    const customs = p.customTransitions.map((c) => ({ value: c.id, label: `★ ${c.name}` }));
    return [
      { value: 'random', label: '🎲 Random' },
      { value: 'cut', label: 'Hard Cut' },
      ...customs,
      ...builtins,
    ];
  }, [p.customTransitions]);

  const ready = !!p.audio && p.visuals.length > 0;

  async function onExport() {
    if (!p.audio) return;
    const out = `${p.audio.name.replace(/\.[^.]+$/, '')}-autoreel.mp4`;
    const res = await exportVideo({
      timeline: p.timeline,
      audioUri: p.audio.uri,
      outPath: out,
      settings: p.settings,
    });
    if (res.ok) Alert.alert('Exported', res.outPath ?? out);
    else Alert.alert('Export', res.error ?? 'Export failed.');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Preview */}
      <View style={[styles.preview, { width: previewW, height: previewH }]}>
        {ready ? (
          <View style={{ width: canvasW, height: previewH }}>
            <PreviewCanvas
              timeline={p.timeline}
              time={time}
              width={canvasW}
              height={previewH}
              transition={p.settings.transition}
              transitionDuration={p.settings.transitionDuration}
              customTransitions={p.customTransitions}
              seed={p.settings.seed}
            />
          </View>
        ) : (
          <Text style={styles.previewHint}>Add a voiceover and visuals to preview your reel</Text>
        )}
      </View>

      {/* Transport */}
      <Row gap={10}>
        <Pressable onPress={toggle} disabled={!ready} style={[styles.playBtn, !ready && { opacity: 0.4 }]}>
          <Text style={styles.playIcon}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <TimelineStrip timeline={p.timeline} time={time} onSeek={seek} />
        </View>
      </Row>

      {/* Sources */}
      <Label>1 · Voiceover</Label>
      <Btn label={p.audio ? `♪ ${p.audio.name}` : 'Choose audio file'} onPress={async () => {
        const a = await pickAudio();
        if (a) p.setAudio(a);
      }} />

      <Label>2 · Visuals ({p.visuals.length})</Label>
      <Row gap={8}>
        <Btn label="+ Add images / clips" flex onPress={async () => {
          const v = await pickVisuals();
          if (v.length) p.addVisuals(v);
        }} />
        {p.visuals.length > 0 && <Btn label="Clear" variant="danger" onPress={p.clearVisuals} />}
      </Row>
      <View style={{ marginTop: 8 }}>
        {p.visuals.map((v, i) => (
          <VisualRow
            key={v.id}
            visual={v}
            index={i}
            count={p.visuals.length}
            onUp={() => p.reorderVisuals(i, i - 1)}
            onDown={() => p.reorderVisuals(i, i + 1)}
            onRemove={() => p.removeVisual(v.id)}
          />
        ))}
      </View>

      {/* Instructions */}
      <Label>3 · Placement instructions</Label>
      <Text style={styles.hint}>
        Paste your AI timecodes — e.g. “visual 1: 00:00 - 00:56”, “virtual 2 till 01:03”. Blank =
        spread evenly.
      </Text>
      <TextInput
        style={styles.instructions}
        placeholder={'visual 1: 00:00 - 00:56\nvisual 2 till 01:03\nvisual 3 till 01:40'}
        placeholderTextColor={theme.muted}
        multiline
        value={p.instructions}
        onChangeText={p.setInstructions}
      />

      {/* Motion */}
      <Label>4 · Motion</Label>
      <ChipRow options={ANIMATIONS} value={p.settings.animation} onChange={(v) => p.updateSettings({ animation: v })} />

      {/* Transitions */}
      <Label>5 · Transition</Label>
      <ChipRow
        options={transitionOptions}
        value={p.settings.transition}
        onChange={(v) => p.updateSettings({ transition: v })}
      />
      <Row>
        <Text style={styles.sliderLabel}>Duration · {p.settings.transitionDuration.toFixed(2)}s</Text>
      </Row>
      <Slider
        value={p.settings.transitionDuration}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => p.updateSettings({ transitionDuration: v })}
      />

      {/* Export */}
      <Label>6 · Export</Label>
      <ChipRow
        options={QUALITIES.map((q) => ({ value: q.value, label: q.label }))}
        value={p.settings.quality}
        onChange={(v) => p.updateSettings({ quality: v })}
      />
      <View style={{ height: 12 }} />
      <Btn label="Export video" variant="primary" disabled={!ready} onPress={onExport} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    marginBottom: 12,
  },
  previewHint: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: theme.muted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
  instructions: {
    backgroundColor: theme.panel,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    padding: 10,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  sliderLabel: { color: theme.muted, fontSize: 12, marginTop: 10 },
});
