import type { TimelinePreviewItem } from '../../../shared/ipc';
import { fmtClock } from '../lib/format';

interface Props {
  items: TimelinePreviewItem[];
  totalDuration: number;
}

const SWATCHES = ['#5b8def', '#e0729b', '#43b581', '#e8a33d', '#9b6ef3', '#3fb6c9', '#d76b5a', '#7f8fa6'];

/**
 * Visual + tabular timeline. The bar shows each visual's share of the audio;
 * the table lists exact in/out points so the user can sanity-check the AI's
 * placement against the narration.
 */
export function TimelinePreview({ items, totalDuration }: Props) {
  if (items.length === 0 || totalDuration <= 0) {
    return <div className="empty">Add audio and visuals to see the computed timeline.</div>;
  }

  return (
    <div className="timeline">
      <div className="ruler">
        {items.map((it, i) => (
          <div
            key={it.index}
            className="slot"
            style={{ width: `${(it.duration / totalDuration) * 100}%`, background: SWATCHES[i % SWATCHES.length] }}
            title={`#${it.index + 1} ${it.name} · ${fmtClock(it.start)}–${fmtClock(it.end)}`}
          >
            <span className="slot-label">{it.index + 1}</span>
          </div>
        ))}
      </div>

      <div className="segtable">
        {items.map((it, i) => (
          <div className="segrow" key={it.index}>
            <span className="dot" style={{ background: SWATCHES[i % SWATCHES.length] }} />
            <span className="seg-idx">#{it.index + 1}</span>
            <span className="seg-name ellipsis" title={it.name}>{it.name}</span>
            <span className="seg-time mono">{fmtClock(it.start)} → {fmtClock(it.end)}</span>
            <span className="seg-dur muted">{it.duration.toFixed(1)}s</span>
            <span className="seg-anim muted">{it.animation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
