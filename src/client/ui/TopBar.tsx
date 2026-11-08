import type { House } from '../../shared/house';
import { useApp } from '../store';

export function TopBar({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const setLevel = useApp((s) => s.setLevel);
  const wallMode = useApp((s) => s.wallMode);
  const setWallMode = useApp((s) => s.setWallMode);
  const requestRotate = useApp((s) => s.requestRotate);
  const requestFocus = useApp((s) => s.requestFocus);
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  const user = useApp((s) => s.user);
  const azimuth = useApp((s) => s.azimuth);

  // kompas: noordvector geprojecteerd op scherm-rechts en scherm-boven
  const [nx, nz] = house.north;
  const right = [Math.cos(azimuth), -Math.sin(azimuth)];
  const up = [-Math.sin(azimuth), -Math.cos(azimuth)];
  const compassDeg = (Math.atan2(nx * right[0] + nz * right[1], nx * up[0] + nz * up[1]) * 180) / Math.PI;

  return (
    <div className="topbar">
      <div className="brand" title={house.name}>
        <span className="brand-dot" />
        <span className="brand-name">Waalstraat 16</span>
      </div>

      <div className="seg levels" role="tablist" aria-label="Verdieping">
        {house.levels.map((l, i) => (
          <button key={l.id} className={level === i ? 'on' : ''} onClick={() => setLevel(i)} title={l.name}>
            {l.short}
          </button>
        ))}
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')} title="Hele huis met dak">
          Buiten
        </button>
      </div>

      <div className="seg walls" aria-label="Muren">
        {(
          [
            ['up', 'Hoog', 'Muren hoog'],
            ['cutaway', 'Weg', 'Muren aan de camerakant weggesneden'],
            ['down', 'Laag', 'Alle muren laag'],
          ] as const
        ).map(([m, label, title]) => (
          <button key={m} className={wallMode === m ? 'on' : ''} onClick={() => setWallMode(m)} title={title} disabled={level === 'all'}>
            {label}
          </button>
        ))}
      </div>

      <div className="tools">
        <button className="icon" onClick={() => requestRotate(-1)} title="Draai 90° linksom" aria-label="Draai linksom">
          ⟲
        </button>
        <button className="icon" onClick={() => requestRotate(1)} title="Draai 90° rechtsom" aria-label="Draai rechtsom">
          ⟳
        </button>
        <button className="icon" onClick={requestFocus} title="Hele huis in beeld" aria-label="Centreren">
          ⌖
        </button>
        <div className="compass" title="Noorden">
          <span style={{ transform: `rotate(${compassDeg}deg)` }}>▲</span>
          <small>N</small>
        </div>
      </div>

      <div className="spacer" />

      <button className={`primary libbtn ${panel === 'library' ? 'on' : ''}`} onClick={() => setPanel(panel === 'library' ? null : 'library')}>
        Bibliotheek
      </button>
      {user && (
        <button className={`ghost user ${panel === 'account' ? 'on' : ''}`} title="Account en gebruikers" onClick={() => setPanel(panel === 'account' ? null : 'account')}>
          {user.displayName.slice(0, 1).toUpperCase()}
        </button>
      )}
    </div>
  );
}
