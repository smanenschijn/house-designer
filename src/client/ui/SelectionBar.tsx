import { useEffect } from 'react';
import type { House } from '../../shared/house';
import { roomAt } from '../../shared/placement';
import { useApp } from '../store';
import { deleteSelected, duplicateSelected, fmtSize, nudgeSelected, rotateSelected } from './actions';

export function SelectionBar({ house }: { house: House }) {
  const selectedId = useApp((s) => s.selectedId);
  const placement = useApp((s) => s.placements.find((p) => p.id === s.selectedId));
  const item = useApp((s) => s.items.find((i) => i.id === placement?.itemId));
  const setPanel = useApp((s) => s.setPanel);
  const snap = useApp((s) => s.snap);
  const setSnap = useApp((s) => s.setSnap);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!useApp.getState().selectedId) return;
      const step = e.shiftKey ? 0.1 : 0.01;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelected();
          break;
        case 'r':
        case 'R':
          rotateSelected(e.shiftKey ? -90 : 90);
          break;
        case 'q':
          rotateSelected(15);
          break;
        case 'e':
          rotateSelected(-15);
          break;
        case 'd':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            duplicateSelected();
          }
          break;
        case 'Escape':
          useApp.getState().select(null);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nudgeScreen(-step, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudgeScreen(step, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudgeScreen(0, step);
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudgeScreen(0, -step);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!selectedId || !placement || !item) return null;
  const level = house.levels.find((l) => l.id === placement.levelId);
  const room = level ? roomAt(level, [placement.x, placement.z]) : null;

  return (
    <div className="selbar">
      <div className="sel-info">
        <strong>{item.name}</strong>
        <span className="muted">
          {fmtSize(item)}
          {room ? ` · ${room.name}` : ''} · {Math.round(placement.rotation)}°
        </span>
      </div>
      <div className="sel-actions">
        <button onClick={() => rotateSelected(90)} title="Draai 90° (R)">
          ⟲ 90°
        </button>
        <button onClick={() => rotateSelected(15)} title="Draai 15° (Q)">
          ⟲ 15°
        </button>
        <button onClick={() => rotateSelected(-15)} title="Draai -15° (E)">
          ⟳ 15°
        </button>
        <button onClick={duplicateSelected} title="Dupliceren (Ctrl/⌘+D)">
          ⧉
        </button>
        <button onClick={() => setPanel('editor', item.id)} title="Meubel bewerken">
          ✎
        </button>
        <button className={snap ? 'on' : ''} onClick={() => setSnap(!snap)} title="Magnetisch tegen muren (Alt = tijdelijk uit)">
          🧲
        </button>
        <button className="danger" onClick={deleteSelected} title="Verwijderen (Delete)">
          🗑
        </button>
      </div>
    </div>
  );
}

/** pijltjestoetsen bewegen in schermrichting (rekening houdend met camera-azimut) */
function nudgeScreen(right: number, up: number) {
  const az = useApp.getState().azimuth;
  const rx = Math.cos(az), rz = -Math.sin(az);
  const ux = -Math.sin(az), uz = -Math.cos(az);
  nudgeSelected(rx * right + ux * up, rz * right + uz * up);
}
