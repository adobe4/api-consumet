import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useProject } from '../state/ProjectContext';
import { usePlayhead } from '../preview/usePlayhead';
import { PreviewCanvas } from '../preview/PreviewCanvas';
import { TimelineStrip } from '../components/TimelineStrip';
import { VisualRow } from '../components/VisualRow';
import { Btn, Card, ChipRow, Label, Row } from '../components/Controls';
import { Slider } from '../components/Slider';
import { useToast } from '../components/Toast';
import { pickAudio, pickVisuals } from '../lib/pickers';
import { fmtClock } from '../lib/format';
import { exportVideo } from '../native/export';
import { BUILTIN_TRANSITION_PARAMS } from '../preview/transitionShader';
import { ACCENT_GRADIENT, theme } from '../theme';
import { ASPECT_PRESETS } from '../types';
import { parseInstructions } from '../../engine';
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
  const toast = useToast();
  const { time, playing, toggle, pause, seek } = usePlayhead(p.audio?.uri ?? null, p.timeline.duration);
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);

  const currentAspect =
    ASPECT_PRESETS.find((a) => a.width === p.settings.width && a.height === p.settings.height)?.id ?? '';

  const screenW = Dimensions.get('window').width;
  const previewW = screenW - 24;
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

  const overrideTransitionOptions = useMemo(
    () => [{ value: 'follow', label: 'Follow global' }, ...transitionOptions],
    [transitionOptions],
  );
  const overrideAnimationOptions = useMemo(
    () => [{ value: 'follow', label: 'Follow global' } as const, ...ANIMATIONS],
    [],
  );

  const parsedCount = useMemo(
    () => parseInstructions(p.instructions).length,
    [p.instructions],
  );

  const segs = p.timeline.segments;
  const currentSegment = useMemo(
    () => segs.find((s) => time >= s.start && time < s.end) ?? segs[segs.length - 1],
    [segs, time],
  );

  const selectedVisual = p.visuals.find((v) => v.id === selectedVisualId) ?? null;
  const ready = !!p.audio && p.visuals.length > 0;
  const usingRandom = p.settings.animation === 'random' || p.settings.transition === 'random';

  function jumpCut(dir: 1 | -1) {
    if (segs.length === 0) return;
    pause();
    if (dir === 1) {
      const next = segs.find((s) => s.start > time + 0.05);
      seek(next ? next.start : p.timeline.duration);
    } else {
      const prev = [...segs].reverse().find((s) => s.start < time - 0.25);
      seek(prev ? prev.start : 0);
    }
  }

  async function onExport() {
    if (!p.audio) return;
    const out = `${p.audio.name.replace(/\.[^.]+$/, '')}-vinei.mp4`;
    const res = await exportVideo({
      timeline: p.timeline,
      audioUri: p.audio.uri,
      outPath: out,
      settings: p.settings,
    });
    if (res.ok) toast.show(`Exported ${res.outPath ?? out}`);
    else toast.show(res.error ?? 'Export failed.', 'info');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* ---- Preview ---- */}
      <Animated.View entering={FadeInDown.duration(300)} style={[styles.preview, { width: previewW, height: previewH }]}>
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
              transitionOverrides={p.transitionOverrides}
              seed={p.settings.seed}
            />
          </View>
        ) : (
          <Text style={styles.previewHint}>Add a voiceover and visuals to preview your reel</Text>
        )}
      </Animated.View>

      {/* ---- Transport ---- */}
      <Row gap={9}>
        <Pressable onPress={() => jumpCut(-1)} disabled={!ready} style={[styles.skipBtn, !ready && styles.off]}>
          <Text style={styles.skipIcon}>⏮</Text>
        </Pressable>
        <Pressable onPress={toggle} disabled={!ready} style={!ready ? styles.off : undefined}>
          <LinearGradient
            colors={[...ACCENT_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playBtn}
          >
            <Text style={styles.playIcon}>{playing ? '❚❚' : '▶'}</Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={() => jumpCut(1)} disabled={!ready} style={[styles.skipBtn, !ready && styles.off]}>
          <Text style={styles.skipIcon}>⏭</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <TimelineStrip timeline={p.timeline} time={time} onSeek={seek} onScrubStart={pause} />
        </View>
      </Row>
      {ready && currentSegment && (
        <Text style={styles.nowPlaying} numberOfLines={1}>
          #{currentSegment.index + 1} · {currentSegment.visual.name ?? 'visual'} ·{' '}
          {currentSegment.animation} · {fmtClock(currentSegment.start)}–{fmtClock(currentSegment.end)}
        </Text>
      )}

      {/* ---- Format ---- */}
      <Card delay={40}>
        <Label>Format</Label>
        <ChipRow
          options={ASPECT_PRESETS.map((a) => ({ value: a.id, label: `${a.label} · ${a.hint}` }))}
          value={currentAspect}
          onChange={(id) => {
            const a = ASPECT_PRESETS.find((x) => x.id === id);
            if (a) p.updateSettings({ width: a.width, height: a.height });
          }}
        />
      </Card>

      {/* ---- Sources ---- */}
      <Card delay={80}>
        <Label>1 · Voiceover</Label>
        <Btn
          label={p.audio ? `♪  ${p.audio.name}  ·  ${fmtClock(p.audio.duration)}` : 'Choose audio file'}
          onPress={async () => {
            const a = await pickAudio();
            if (a) {
              p.setAudio(a);
              toast.show(`Audio loaded · ${fmtClock(a.duration)}`);
            }
          }}
        />

        <View style={{ height: 14 }} />
        <Label>2 · Visuals ({p.visuals.length})</Label>
        <Row gap={8}>
          <Btn
            label="＋ Add images / clips"
            flex
            onPress={async () => {
              const v = await pickVisuals();
              if (v.length) {
                p.addVisuals(v);
                toast.show(`Added ${v.length} visual${v.length > 1 ? 's' : ''}`);
              }
            }}
          />
          {p.visuals.length > 0 && (
            <Btn
              label="Clear"
              variant="danger"
              onPress={() => {
                p.clearVisuals();
                setSelectedVisualId(null);
              }}
            />
          )}
        </Row>
        <View style={{ marginTop: 10 }}>
          {p.visuals.map((v, i) => (
            <VisualRow
              key={v.id}
              visual={v}
              index={i}
              count={p.visuals.length}
              selected={v.id === selectedVisualId}
              hasOverrides={!!p.animationOverrides[v.id] || !!p.transitionOverrides[v.id]}
              onSelect={() => setSelectedVisualId((cur) => (cur === v.id ? null : v.id))}
              onUp={() => p.reorderVisuals(i, i - 1)}
              onDown={() => p.reorderVisuals(i, i + 1)}
              onRemove={() => {
                p.removeVisual(v.id);
                if (selectedVisualId === v.id) setSelectedVisualId(null);
              }}
            />
          ))}
        </View>

        {/* Per-visual overrides for the selected visual */}
        {selectedVisual && (
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(150)}
            layout={LinearTransition.springify().damping(18)}
            style={styles.overridePanel}
          >
            <Text style={styles.overrideTitle} numberOfLines={1}>
              Fine-tune “{selectedVisual.name}”
            </Text>
            <Text style={styles.overrideSub}>Motion for this visual</Text>
            <ChipRow
              options={overrideAnimationOptions.map((a) => ({ value: a.value, label: a.label }))}
              value={p.animationOverrides[selectedVisual.id] ?? 'follow'}
              onChange={(v) =>
                p.setAnimationOverride(selectedVisual.id, v === 'follow' ? null : (v as AnimationKind))
              }
            />
            <Text style={styles.overrideSub}>Transition into this visual</Text>
            <ChipRow
              options={overrideTransitionOptions}
              value={p.transitionOverrides[selectedVisual.id] ?? 'follow'}
              onChange={(v) => p.setTransitionOverride(selectedVisual.id, v === 'follow' ? null : v)}
            />
          </Animated.View>
        )}
      </Card>

      {/* ---- Instructions ---- */}
      <Card delay={120}>
        <Label>3 · Placement instructions</Label>
        <Text style={styles.hint}>
          Paste your AI timecodes — e.g. “visual 1: 00:00 - 00:56”, “virtual 2 till 01:03”. Blank =
          spread evenly.
        </Text>
        <TextInput
          style={styles.instructions}
          placeholder={'visual 1: 00:00 - 00:56\nvisual 2 till 01:03\nvisual 3 till 01:40'}
          placeholderTextColor={theme.faint}
          multiline
          value={p.instructions}
          onChangeText={p.setInstructions}
        />
        {p.instructions.trim().length > 0 && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.parseRow}>
            <Text style={[styles.parseText, parsedCount === 0 && { color: theme.accent }]}>
              {parsedCount === 0
                ? '⚠ No timecodes recognised yet'
                : `✓ ${parsedCount} placement${parsedCount > 1 ? 's' : ''} parsed`}
              {parsedCount > 0 && p.visuals.length > 0 && parsedCount !== p.visuals.length
                ? `  ·  ${p.visuals.length} visuals loaded`
                : ''}
            </Text>
          </Animated.View>
        )}
      </Card>

      {/* ---- Style ---- */}
      <Card delay={160}>
        <Label>4 · Motion</Label>
        <ChipRow
          options={ANIMATIONS}
          value={p.settings.animation}
          onChange={(v) => p.updateSettings({ animation: v })}
        />

        <View style={{ height: 12 }} />
        <Label>5 · Transition</Label>
        <ChipRow
          options={transitionOptions}
          value={p.settings.transition}
          onChange={(v) => p.updateSettings({ transition: v })}
        />
        <Text style={styles.sliderLabel}>Duration · {p.settings.transitionDuration.toFixed(2)}s</Text>
        <Slider
          value={p.settings.transitionDuration}
          min={0.1}
          max={2}
          step={0.05}
          onChange={(v) => p.updateSettings({ transitionDuration: v })}
        />
        {usingRandom && (
          <Animated.View entering={FadeIn.duration(200)}>
            <Btn
              small
              label="🎲 Shuffle random mix"
              onPress={() => {
                p.updateSettings({ seed: Math.floor(Math.random() * 1_000_000) });
                toast.show('New random mix rolled', 'info');
              }}
            />
          </Animated.View>
        )}
      </Card>

      {/* ---- Export ---- */}
      <Card delay={200}>
        <Label>6 · Export</Label>
        <ChipRow
          options={QUALITIES.map((q) => ({ value: q.value, label: q.label }))}
          value={p.settings.quality}
          onChange={(v) => p.updateSettings({ quality: v })}
        />
        <View style={{ height: 12 }} />
        <Btn label="Export video" variant="primary" disabled={!ready} onPress={onExport} />
      </Card>
      <View style={{ height: 30 }} />
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
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  previewHint: { color: theme.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  playBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.accent,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  playIcon: { color: '#fff', fontSize: 17, fontWeight: '800' },
  skipBtn: {
    width: 38,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipIcon: { color: theme.muted, fontSize: 16 },
  off: { opacity: 0.35 },
  nowPlaying: {
    color: theme.faint,
    fontSize: 11.5,
    marginTop: 2,
    marginBottom: 12,
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.muted, fontSize: 12, marginBottom: 9, lineHeight: 17 },
  instructions: {
    backgroundColor: theme.bg,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    padding: 11,
    minHeight: 92,
    textAlignVertical: 'top',
    fontSize: 13,
    lineHeight: 19,
  },
  parseRow: { marginTop: 8 },
  parseText: { color: theme.good, fontSize: 12, fontWeight: '600' },
  sliderLabel: { color: theme.muted, fontSize: 12, marginTop: 12 },
  overridePanel: {
    marginTop: 6,
    backgroundColor: theme.bg,
    borderColor: theme.accentBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  overrideTitle: { color: theme.text, fontSize: 13.5, fontWeight: '700', marginBottom: 8 },
  overrideSub: { color: theme.muted, fontSize: 11.5, marginTop: 6, marginBottom: 6 },
});
