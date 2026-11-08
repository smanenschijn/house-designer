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

const house = waalstraat16;

export function App() {
  const user = useApp((s) => s.user);
  const loaded = useApp((s) => s.loaded);
  const panel = useApp((s) => s.panel);
  const error = useApp((s) => s.error);
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
    // eenvoudige live-synchronisatie: elke paar seconden kijken of er iets veranderd is
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') useApp.getState().poll().catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => useApp.getState().setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  if (!checked) return null;
  if (!user) return <Login onLogin={(u) => useApp.getState().setUser(u)} />;

  return (
    <div className={`app ${panel ? 'with-panel' : ''}`}>
      <div className="viewport">
        <Scene house={house} />
        {!loaded && <div className="loading">Laden…</div>}
      </div>
      <TopBar house={house} />
      <SelectionBar house={house} />
      {panel === 'library' && <LibraryPanel house={house} />}
      {panel === 'editor' && <ItemEditor />}
      {panel === 'account' && <AccountPanel />}
      {error && (
        <div className="toast" onClick={() => useApp.getState().setError(null)}>
          {error}
        </div>
      )}
      <div className="hint">
        <span className="desk">Slepen = schuiven · rechtermuis = draaien · scroll = zoomen</span>
        <span className="touch">1 vinger = schuiven · 2 vingers = zoomen/draaien</span>
      </div>
    </div>
  );
}
