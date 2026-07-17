import { useEffect, useMemo, useState, useCallback } from 'react';
import type {
  RenderRequest,
  TimelinePreviewItem,
  UIVisual,
} from '../../shared/ipc';
import type { AnimationKind, QualityPreset } from '../../engine/types';
import { VisualList } from './components/VisualList';
import { TimelinePreview } from './components/TimelinePreview';
import { fmtClock } from './lib/format';

const ANIMATIONS: { value: AnimationKind; label: string }[] = [
  { value: 'ken-burns', label: 'Ken Burns (zoom + drift)' },
  { value: 'zoom-in', label: 'Slow Zoom In' },
  { value: 'zoom-out', label: 'Slow Zoom Out' },
  { value: 'zoom-in-out', label: 'Zoom In then Out' },
  { value: 'pan-left', label: 'Pan Left' },
  { value: 'pan-right', label: 'Pan Right' },
  { value: 'random', label: 'Random per visual' },
  { value: 'none', label: 'None (static)' },
];

const QUALITIES: { value: QualityPreset; label: string }[] = [
  { value: 'high', label: 'High (H.264, great quality)' },
  { value: 'max', label: 'Max (H.264, near-lossless, huge)' },
  { value: 'prores', label: 'ProRes 422 HQ (editing master)' },
];

type TransitionOpt = { name: string; label: string; group: string };

export function App() {
  const [audio, setAudio] = useState<{ path: string; duration: number } | null>(null);
  const [visuals, setVisuals] = useState<UIVisual[]>([]);
  const [instructions, setInstructions] = useState('');
  const [animation, setAnimation] = useState<AnimationKind>('ken-burns');
  const [transition, setTransition] = useState('random');
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [resolution, setResolution] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [seed, setSeed] = useState('');

  const [transitionOpts, setTransitionOpts] = useState<TransitionOpt[]>([]);
  const [preview, setPreview] = useState<TimelinePreviewItem[]>([]);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressInfo, setProgressInfo] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.autoreel.transitions().then(setTransitionOpts);
    return window.autoreel.onProgress((p) => {
      setProgress(p.progress);
      setProgressInfo(
        `${Math.round(p.progress * 100)}%` + (p.speed ? ` · ${p.speed}` : '') + (p.fps ? ` · ${p.fps.toFixed(0)} fps` : ''),
      );
    });
  }, []);

  const [width, height] = useMemo(() => {
    const [w, h] = resolution.split('x').map((n) => parseInt(n, 10));
    return [w || 1920, h || 1080];
  }, [resolution]);

  const buildRequest = useCallback(
    (outPath: string): RenderRequest => ({
      audioPath: audio?.path ?? '',
      audioDuration: audio?.duration ?? 0,
      visuals,
      instructionsText: instructions,
      outPath,
      animation,
      transition,
      transitionDuration,
      quality,
      fps,
      width,
      height,
      seed: seed.trim() ? parseInt(seed, 10) : undefined,
    }),
    [audio, visuals, instructions, animation, transition, transitionDuration, quality, fps, width, height, seed],
  );

  // Recompute the timeline preview whenever the inputs change (debounced).
  useEffect(() => {
    if (!audio || visuals.length === 0) {
      setPreview([]);
      return;
    }
    const t = setTimeout(() => {
      window.autoreel.previewTimeline(buildRequest('')).then(setPreview).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [audio, visuals, instructions, animation, seed, fps, buildRequest]);

  const groupedTransitions = useMemo(() => {
    const groups: Record<string, TransitionOpt[]> = {};
    for (const t of transitionOpts) (groups[t.group] ||= []).push(t);
    return groups;
  }, [transitionOpts]);

  const canRender = audio && visuals.length > 0 && !rendering;

  async function onAddAudio() {
    const res = await window.autoreel.pickAudio();
    if (res) setAudio(res);
  }
  async function onAddVisuals() {
    const added = await window.autoreel.pickVisuals();
    if (added.length) setVisuals((v) => [...v, ...added]);
  }

  async function onRender() {
    setError(null);
    setResult(null);
    const defaultName = `autoreel-${Date.now()}.${quality === 'prores' ? 'mov' : 'mp4'}`;
    const out = await window.autoreel.pickOutput(defaultName);
    if (!out) return;
    setRendering(true);
    setProgress(0);
    setProgressInfo('starting…');
    const res = await window.autoreel.startRender(buildRequest(out));
    setRendering(false);
    if (res.ok) setResult(res.outPath);
    else setError(res.error);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> AutoReel
        </div>
        <div className="tagline">Audio + visuals + timecodes → a finished, synced video</div>
      </header>

      <main className="layout">
        {/* ---- Left: sources ---- */}
        <section className="panel sources">
          <h2>1 · Voiceover</h2>
          <button className="btn primary block" onClick={onAddAudio}>
            {audio ? 'Change audio' : 'Choose audio file'}
          </button>
          {audio && (
            <div className="audio-info">
              <div className="mono ellipsis">{basename(audio.path)}</div>
              <div className="muted">length {fmtClock(audio.duration)}</div>
            </div>
          )}

          <h2>
            2 · Visuals <span className="count">{visuals.length}</span>
          </h2>
          <div className="row gap">
            <button className="btn block" onClick={onAddVisuals}>+ Add images / clips</button>
          </div>
          {visuals.length > 1 && (
            <div className="row gap tools">
              <button
                className="btn small"
                onClick={() =>
                  setVisuals((v) =>
                    [...v].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
                  )
                }
              >
                Sort by name
              </button>
              <button className="btn small danger" onClick={() => setVisuals([])}>Clear</button>
            </div>
          )}
          <VisualList visuals={visuals} onChange={setVisuals} />
        </section>

        {/* ---- Center: instructions + timeline ---- */}
        <section className="panel middle">
          <h2>3 · Placement instructions</h2>
          <p className="muted small">
            Paste the AI’s timecodes. Understood formats include
            <code>visual 1: 00:00 - 00:56</code>, <code>virtual 2 till 01:03</code>. Leave blank to
            spread visuals evenly.
          </p>
          <textarea
            className="instructions"
            placeholder={'visual 1: 00:00 - 00:56\nvisual 2 till 01:03\nvisual 3 till 01:40'}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            spellCheck={false}
          />

          <h2>Timeline preview</h2>
          <TimelinePreview items={preview} totalDuration={audio?.duration ?? 0} />
        </section>

        {/* ---- Right: styling + export ---- */}
        <section className="panel options">
          <h2>4 · Motion</h2>
          <label className="field">
            <span>Animation</span>
            <select value={animation} onChange={(e) => setAnimation(e.target.value as AnimationKind)}>
              {ANIMATIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>

          <h2>5 · Transitions</h2>
          <label className="field">
            <span>Style</span>
            <select value={transition} onChange={(e) => setTransition(e.target.value)}>
              <option value="random">🎲 Random per cut</option>
              <option value="cut">Hard cut (none)</option>
              {Object.entries(groupedTransitions).map(([group, opts]) => (
                <optgroup key={group} label={group}>
                  {opts.map((o) => (
                    <option key={o.name} value={o.name}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Duration · {transitionDuration.toFixed(2)}s</span>
            <input
              type="range" min={0.1} max={2} step={0.05}
              value={transitionDuration}
              disabled={transition === 'cut'}
              onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
            />
          </label>

          <h2>6 · Export</h2>
          <label className="field">
            <span>Quality</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as QualityPreset)}>
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
          </label>
          <div className="row gap">
            <label className="field">
              <span>Resolution</span>
              <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option value="1920x1080">1080p (16:9)</option>
                <option value="3840x2160">4K (16:9)</option>
                <option value="1080x1920">1080×1920 (9:16)</option>
                <option value="1080x1080">1080² (1:1)</option>
              </select>
            </label>
            <label className="field narrow">
              <span>FPS</span>
              <select value={fps} onChange={(e) => setFps(parseInt(e.target.value, 10))}>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Random seed (optional)</span>
            <input
              type="text" placeholder="e.g. 42" value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>

          <button className="btn primary block big" disabled={!canRender} onClick={onRender}>
            {rendering ? 'Rendering…' : 'Render video'}
          </button>

          {rendering && (
            <div className="progress-wrap">
              <div className="progress"><div className="bar" style={{ width: `${progress * 100}%` }} /></div>
              <div className="muted small">{progressInfo}</div>
              <button className="btn small danger" onClick={() => window.autoreel.cancelRender()}>Cancel</button>
            </div>
          )}
          {result && (
            <div className="done">
              ✓ Exported.
              <button className="btn small" onClick={() => window.autoreel.showInFolder(result)}>Show in folder</button>
            </div>
          )}
          {error && <div className="error">⚠ {error}</div>}
        </section>
      </main>
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}
