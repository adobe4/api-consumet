import type { UIVisual } from '../../../shared/ipc';

interface Props {
  visuals: UIVisual[];
  onChange: (next: UIVisual[]) => void;
}

/**
 * Ordered list of visuals with reorder (up/down), remove, and native
 * drag-and-drop reordering. The order here is the order visuals appear in the
 * finished video (visual #1 first).
 */
export function VisualList({ visuals, onChange }: Props) {
  function move(from: number, to: number) {
    if (to < 0 || to >= visuals.length) return;
    const next = [...visuals];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }
  function remove(id: string) {
    onChange(visuals.filter((v) => v.id !== id));
  }

  if (visuals.length === 0) {
    return <div className="empty">No visuals yet. Add images or short clips in playback order.</div>;
  }

  return (
    <ol className="visual-list">
      {visuals.map((v, i) => (
        <li
          key={v.id}
          className="visual-item"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (!Number.isNaN(from)) move(from, i);
          }}
        >
          <span className="idx">{i + 1}</span>
          <span className={`kind ${v.kind}`}>{v.kind === 'video' ? '▶' : '🖼'}</span>
          <span className="name ellipsis" title={v.path}>{v.name}</span>
          <span className="item-actions">
            <button className="icon" title="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>▲</button>
            <button className="icon" title="Move down" onClick={() => move(i, i + 1)} disabled={i === visuals.length - 1}>▼</button>
            <button className="icon danger" title="Remove" onClick={() => remove(v.id)}>✕</button>
          </span>
        </li>
      ))}
    </ol>
  );
}
