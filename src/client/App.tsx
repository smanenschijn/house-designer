import { useEffect, useState } from 'react';
import { waalstraat16 } from '../shared/waalstraat16';
import { ApiError, api } from './api';
import { useApp } from './store';
import { Scene } from './three/Scene';
import { ItemEditor } from './ui/ItemEditor';
import { LibraryPanel } from './ui/LibraryPanel';
import { SelectionBar } from './ui/SelectionBar';
import { TopBar } from './ui/TopBar';

const house = waalstraat16;

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const u = await api.login(username.trim(), password);
            useApp.getState().setUser(u);
            onDone();
          } catch (e2) {
            setErr(e2 instanceof ApiError && e2.status === 401 ? 'Onbekende gebruiker of verkeerd wachtwoord.' : String(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Waalstraat 16</h1>
        <p className="muted">Ons nieuwe huis inrichten</p>
        <label className="field">
          <span>Gebruikersnaam</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Wachtwoord</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="error-box">{err}</div>}
        <button className="primary block" disabled={busy || !username || !password}>
          {busy ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </div>
  );
}

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
  if (!user) return <Login onDone={() => undefined} />;

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
