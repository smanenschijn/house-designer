import { useEffect, useState } from 'react';
import { waalstraat16 } from '../shared/waalstraat16';
import { api } from './api';
import { useApp } from './store';
import { Scene } from './three/Scene';
import { AccountPanel } from './ui/AccountPanel';
import { ItemEditor } from './ui/ItemEditor';
import { Login } from './ui/Login';
import { LibraryPanel } from './ui/LibraryPanel';
import { SelectionBar } from './ui/SelectionBar';
import { TopBar } from './ui/TopBar';
import { Consent } from './ui/Consent';
import { VariantsPanel } from './ui/VariantsPanel';
import { WalkOverlay } from './ui/WalkOverlay';
import { oauthQuery, renderParams } from './renderMode';

const house = waalstraat16;

export function App() {
  const user = useApp((s) => s.user);
  const loaded = useApp((s) => s.loaded);
  const panel = useApp((s) => s.panel);
  const error = useApp((s) => s.error);
  const camMode = useApp((s) => s.camMode);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((u) => useApp.getState().setUser(u))
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    useApp.getState().load().catch((e) => useApp.getState().setError(String(e)));
    if (renderParams) return; // afbeelding voor Claude: geen live-verbinding nodig
    // live-updates via Server-Sent Events (EventSource verbindt zelf opnieuw na een onderbreking)
    const es = new EventSource('/api/events');
    const refresh = () => useApp.getState().poll().catch(() => undefined);
    es.addEventListener('hello', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      useApp.getState().setOnline(d.online);
      refresh();
    });
    es.addEventListener('change', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { by?: string; what?: string };
      const me = useApp.getState().user?.displayName;
      if (d.by && d.by !== me) useApp.getState().setNotice(d.what ? `${d.by}: ${d.what}` : `${d.by} heeft iets aangepast`);
      refresh();
    });
    es.addEventListener('presence', (e) => useApp.getState().setOnline(JSON.parse((e as MessageEvent).data)));
    // vangnet als de stream ergens wordt gebufferd
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [user]);

  const notice = useApp((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useApp.getState().setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => useApp.getState().setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  if (!checked) return null;
  if (!user) return <Login onLogin={(u) => useApp.getState().setUser(u)} />;
  if (oauthQuery) return <Consent query={oauthQuery} />;
  if (renderParams)
    return (
      <div className="app render-mode">
        <div className="viewport">
          <Scene house={house} />
        </div>
      </div>
    );

  return (
    <div className={`app ${panel ? 'with-panel' : ''} ${camMode === 'walk' ? 'walking' : ''}`}>
      <div className="viewport">
        <Scene house={house} />
        {!loaded && <div className="loading">Laden…</div>}
      </div>
      <TopBar house={house} />
      <SelectionBar house={house} />
      {panel === 'library' && <LibraryPanel house={house} />}
      {panel === 'editor' && <ItemEditor />}
      {panel === 'account' && <AccountPanel />}
      {panel === 'variants' && <VariantsPanel house={house} />}
      {camMode === 'walk' && <WalkOverlay />}
      {notice && <div className="notice glass">{notice}</div>}
      {error && (
        <div className="toast" onClick={() => useApp.getState().setError(null)}>
          {error}
        </div>
      )}
      <div className="hint">
        <span className="desk">Slepen = schuiven · rechtermuis = draaien · scroll = zoomen</span>
        <span className="touch">Tik = selecteren · lang vasthouden of geselecteerd meubel slepen = verplaatsen</span>
      </div>
    </div>
  );
}
