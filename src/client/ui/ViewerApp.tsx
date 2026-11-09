import { useEffect, useState } from 'react';
import type { House } from '../../shared/house';
import { useApp } from '../store';
import { Scene } from '../three/Scene';
import { TopBar } from './TopBar';
import { FocusChip } from './FocusChip';
import { WalkOverlay } from './WalkOverlay';
import { ExportPanel } from './ExportPanel';

/**
 * Meekijken via een gedeelde link: rondkijken, rondlopen, zon/avond en plattegrond,
 * maar niets aanpassen. Wijzigingen van de bewoners komen vanzelf binnen.
 */
export function ViewerApp({ token, house }: { token: string; house: House }) {
  const loaded = useApp((s) => s.loaded);
  const panel = useApp((s) => s.panel);
  const camMode = useApp((s) => s.camMode);
  const viewer = useApp((s) => s.viewer);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    useApp
      .getState()
      .load()
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') useApp.getState().poll().catch(() => undefined);
    }, 15000);
    return () => clearInterval(t);
  }, [token]);

  useEffect(() => {
    document.title = viewer ? `Waalstraat 16 — ${viewer}` : 'Waalstraat 16';
  }, [viewer]);

  if (failed)
    return (
      <div className="viewer-fail">
        <div className="glass">
          <h1>Waalstraat 16</h1>
          <p>{failed}</p>
          <p className="muted">Vraag de bewoners om een nieuwe link.</p>
        </div>
      </div>
    );

  return (
    <div className={`app viewer ${panel ? 'with-panel' : ''} ${camMode === 'walk' ? 'walking' : ''}`}>
      <div className="viewport">
        <Scene house={house} />
        {!loaded && <div className="loading">Laden…</div>}
      </div>
      <TopBar house={house} />
      <FocusChip house={house} />
      {panel === 'export' && <ExportPanel house={house} />}
      {camMode === 'walk' && <WalkOverlay />}
      <div className="hint">
        <span className="desk">Je kijkt mee (alleen bekijken) · slepen = schuiven · rechtermuis = draaien · scroll = zoomen · poppetje = rondlopen</span>
        <span className="touch">Je kijkt mee · één vinger = schuiven · twee vingers = zoomen en draaien</span>
      </div>
    </div>
  );
}
