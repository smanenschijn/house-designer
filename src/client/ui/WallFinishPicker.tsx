import { useMemo, useState } from 'react';
import { WALLPAPERS, WALL_COLORS, type WallFinish, type WallpaperId } from '../../shared/variants';
import { wallpaperSwatch } from '../three/materials';

/** Keuze tussen verf (kleur) en behang (patroon + twee kleuren). */
export function WallFinishPicker({ value, onChange }: { value: WallFinish; onChange: (w: WallFinish) => void }) {
  const [tab, setTab] = useState<'paint' | 'wallpaper'>(value.kind);
  const paper = value.kind === 'wallpaper' ? value : null;

  return (
    <div className="wfp">
      <div className="seg wide small-seg">
        <button className={tab === 'paint' ? 'on' : ''} onClick={() => setTab('paint')}>
          Verf
        </button>
        <button className={tab === 'wallpaper' ? 'on' : ''} onClick={() => setTab('wallpaper')}>
          Behang
        </button>
      </div>
      {tab === 'paint' ? (
        <div className="swatches">
          {WALL_COLORS.map((c) => (
            <button
              key={c.hex}
              className={`swatch ${value.kind === 'paint' && value.color.toLowerCase() === c.hex ? 'on' : ''}`}
              style={{ background: c.hex }}
              title={c.name}
              aria-label={c.name}
              onClick={() => onChange({ kind: 'paint', color: c.hex })}
            />
          ))}
          <label className="swatch custom" title="Eigen kleur">
            <input type="color" value={value.kind === 'paint' ? value.color : '#ede8e0'} onChange={(e) => onChange({ kind: 'paint', color: e.target.value })} />
          </label>
        </div>
      ) : (
        <>
          <div className="papers">
            {WALLPAPERS.map((p) => (
              <PaperTile
                key={p.id}
                id={p.id}
                name={p.name}
                color={paper?.pattern === p.id ? paper.color : p.color}
                accent={paper?.pattern === p.id ? paper.accent : p.accent}
                on={paper?.pattern === p.id}
                onClick={() => onChange({ kind: 'wallpaper', pattern: p.id, color: paper?.pattern === p.id ? paper.color : p.color, accent: paper?.pattern === p.id ? paper.accent : p.accent })}
              />
            ))}
          </div>
          {paper && (
            <div className="grid2">
              <label className="field">
                <span>Achtergrond</span>
                <input type="color" value={paper.color} onChange={(e) => onChange({ ...paper, color: e.target.value })} />
              </label>
              <label className="field">
                <span>Motief</span>
                <input type="color" value={paper.accent} onChange={(e) => onChange({ ...paper, accent: e.target.value })} />
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PaperTile({ id, name, color, accent, on, onClick }: { id: WallpaperId; name: string; color: string; accent: string; on: boolean; onClick: () => void }) {
  const src = useMemo(() => wallpaperSwatch(id, color, accent), [id, color, accent]);
  return (
    <button className={`paper ${on ? 'on' : ''}`} onClick={onClick} title={name}>
      <img src={src} alt="" />
      <span>{name}</span>
    </button>
  );
}
