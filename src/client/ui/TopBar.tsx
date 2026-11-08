import type { House } from '../../shared/house';
import { useApp } from '../store';
import { Icon } from './Icon';
import { SunControl } from './SunControl';

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
  const camMode = useApp((s) => s.camMode);
  const setCamMode = useApp((s) => s.setCamMode);
  const showLabels = useApp((s) => s.showLabels);
  const online = useApp((s) => s.online);
  const editMode = useApp((s) => s.editMode);
  const setEditMode = useApp((s) => s.setEditMode);
  const setShowLabels = useApp((s) => s.setShowLabels);

  // kompas: noordvector geprojecteerd op scherm-rechts en scherm-boven
  const [nx, nz] = house.north;
  const right = [Math.cos(azimuth), -Math.sin(azimuth)];
  const up = [-Math.sin(azimuth), -Math.cos(azimuth)];
  const compassDeg = (Math.atan2(nx * right[0] + nz * right[1], nx * up[0] + nz * up[1]) * 180) / Math.PI;

  return (
    <div className="topbar">
      <div className="brand glass" title={house.name}>
        <span className="brand-name">Waalstraat 16</span>
        <span className="brand-sub">Nijverdal</span>
      </div>

      <div className="seg levels glass" role="tablist" aria-label="Verdieping">
        {house.levels.map((l, i) => (
          <button key={l.id} className={level === i ? 'on' : ''} onClick={() => setLevel(i)} title={l.name}>
            {l.short}
          </button>
        ))}
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')} title="Hele huis met dak">
          Buiten
        </button>
      </div>

      <div className="seg walls glass" aria-label="Buitenmuren">
        <span className="seg-label">Gevels</span>
        {(
          [
            ['up', 'Hoog', 'Alle muren hoog'],
            ['cutaway', 'Weg', 'Buitenmuren aan de camerakant laag'],
            ['down', 'Laag', 'Alle buitenmuren laag'],
          ] as const
        ).map(([m, label, title]) => (
          <button key={m} className={wallMode === m ? 'on' : ''} onClick={() => setWallMode(m)} title={title} disabled={level === 'all'}>
            {label}
          </button>
        ))}
      </div>

      <div className="tools glass">
        <button className="icon" onClick={() => requestRotate(-1)} title="Draai 90° linksom" aria-label="Draai linksom">
          <Icon name="rotateLeft" />
        </button>
        <button className="icon" onClick={() => requestRotate(1)} title="Draai 90° rechtsom" aria-label="Draai rechtsom">
          <Icon name="rotateRight" />
        </button>
        <button className="icon" onClick={requestFocus} title="Hele huis in beeld" aria-label="Centreren">
          <Icon name="focus" />
        </button>
        <button
          className={`icon cam ${camMode === 'persp' ? 'on' : ''}`}
          onClick={() => setCamMode(camMode === 'iso' ? 'persp' : 'iso')}
          title={camMode === 'iso' ? 'Naar perspectief' : 'Naar isometrisch'}
          aria-label="Camera"
        >
          {camMode === 'iso' ? 'ISO' : '3D'}
        </button>
        <button
          className={`icon ${showLabels ? 'on' : ''}`}
          onClick={() => setShowLabels(!showLabels)}
          title={showLabels ? 'Kamernamen verbergen' : 'Kamernamen tonen'}
          aria-label="Kamernamen"
          aria-pressed={showLabels}
        >
          <Icon name="tag" />
        </button>
        <button
          className={`icon ${editMode ? '' : 'on'}`}
          onClick={() => setEditMode(!editMode)}
          title={editMode ? 'Kijkmodus: meubels vastzetten' : 'Bewerken: meubels weer verplaatsbaar maken'}
          aria-label={editMode ? 'Kijkmodus' : 'Bewerken'}
          aria-pressed={!editMode}
        >
          <Icon name={editMode ? 'unlock' : 'lock'} />
        </button>
        <SunControl />
        <div className="compass" title="Noorden">
          <span style={{ transform: `rotate(${compassDeg}deg)` }}>
            <Icon name="north" size={16} fill="currentColor" strokeWidth={1} />
          </span>
        </div>
      </div>

      <div className="spacer" />

      <button className={`primary libbtn ${panel === 'library' ? 'on' : ''}`} onClick={() => setPanel(panel === 'library' ? null : 'library')}>
        <Icon name="library" />
        Bibliotheek
      </button>
      {online
        .filter((o) => o.id !== user?.id)
        .map((o) => (
          <span key={o.id} className="peer glass" title={`${o.name} is online`}>
            {o.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      {user && (
        <button className={`user glass ${panel === 'account' ? 'on' : ''}`} title="Account en gebruikers" onClick={() => setPanel(panel === 'account' ? null : 'account')}>
          {user.displayName.slice(0, 1).toUpperCase()}
        </button>
      )}
    </div>
  );
}
