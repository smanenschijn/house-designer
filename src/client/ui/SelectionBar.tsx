import { useEffect, useMemo } from 'react';
import type { House } from '../../shared/house';
import { roomAt } from '../../shared/placement';
import { clearance, clearanceWarnings } from '../../shared/clearance';
import { findSupport } from '../../shared/stacking';
import { visiblePlacements } from '../store';
import { useApp } from '../store';
import { keyState } from '../keyState';
import { Icon } from './Icon';
import { deleteSelected, duplicateSelected, fmtSize, nudgeSelected, rotateSelected } from './actions';

export function SelectionBar({ house }: { house: House }) {
  const selectedId = useApp((s) => s.selectedId);
  const placement = useApp((s) => s.placements.find((p) => p.id === s.selectedId));
  const item = useApp((s) => s.items.find((i) => i.id === placement?.itemId));
  const setPanel = useApp((s) => s.setPanel);
  const snap = useApp((s) => s.snap);
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  const warnings = useMemo(() => {
    if (!placement) return [];
    return clearanceWarnings(clearance(house, placement, visiblePlacements({ placements, variants, active }), items));
  }, [house, placement, placements, variants, active, items]);
  // waar staat het op? (alleen tonen als het niet op de vloer staat)
  const standingOn = useMemo(() => {
    if (!placement || !item || (placement.y ?? 0) < 0.005) return null;
    const lv = house.levels.find((l) => l.id === placement.levelId);
    if (!lv) return null;
    const s = findSupport(lv, placement, item, placement.id, visiblePlacements({ placements, variants, active }), items, placement.y ?? 0);
    return Math.abs(s.y - (placement.y ?? 0)) < 0.02 && s.on ? `staat op ${s.on}` : `${Math.round((placement.y ?? 0) * 100)} cm boven de vloer`;
  }, [house, placement, item, placements, variants, active, items]);
  const setSnap = useApp((s) => s.setSnap);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!useApp.getState().selectedId) return;
      // spatiebalk ingedrukt: pijltjes draaien het beeld (KeyboardNav), niet het meubel
      if (keyState.space && e.key.startsWith('Arrow')) return;
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
    <div className="selbar glass">
      <div className="sel-info">
        <strong>{item.name}</strong>
        <span className="muted">
          {fmtSize(item)}
          {room ? ` · ${room.name}` : ''}
          {standingOn ? ` · ${standingOn}` : ''} · {Math.round(placement.rotation)}°
        </span>
        {warnings.map((w) => (
          <span key={w} className="sel-warn">
            {w}
          </span>
        ))}
      </div>
      <div className="sel-actions">
        <button onClick={() => rotateSelected(90)} title="Draai 90° (R)">
          <Icon name="rotateLeft" size={16} /> 90°
        </button>
        <button onClick={() => rotateSelected(15)} title="Draai 15° (Q)">
          <Icon name="rotateLeft" size={16} /> 15°
        </button>
        <button onClick={() => rotateSelected(-15)} title="Draai -15° (E)">
          <Icon name="rotateRight" size={16} /> 15°
        </button>
        <button className="icon" onClick={duplicateSelected} title="Dupliceren (Ctrl/⌘+D)" aria-label="Dupliceren">
          <Icon name="copy" />
        </button>
        <button className="icon" onClick={() => setPanel('editor', item.id)} title="Meubel bewerken" aria-label="Bewerken">
          <Icon name="edit" />
        </button>
        <button className={`icon ${snap ? 'on' : ''}`} onClick={() => setSnap(!snap)} title="Magnetisch tegen muren (Alt = tijdelijk uit)" aria-label="Magnetisch">
          <Icon name="magnet" />
        </button>
        <button className="icon danger" onClick={deleteSelected} title="Verwijderen (Delete)" aria-label="Verwijderen">
          <Icon name="trash" />
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
