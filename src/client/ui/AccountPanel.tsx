import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { ApiError, api, type Account, type UserDetail } from '../api';
import { useApp } from '../store';
import { Icon } from './Icon';

const passkeySupported = typeof window !== 'undefined' && !!window.PublicKeyCredential;

function errText(e: unknown) {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.name === 'InvalidStateError') return 'Deze passkey is al toegevoegd.';
  if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Geannuleerd.';
  return e instanceof Error ? e.message : String(e);
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function AccountPanel() {
  const setPanel = useApp((s) => s.setPanel);
  const me = useApp((s) => s.user);
  const [account, setAccount] = useState<Account | null>(null);
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [connections, setConnections] = useState<{ clientId: string; name: string; createdAt: string; lastUsed: string | null }[]>([]);
  const mcpUrl = `${location.origin}/mcp`;
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, u, cons] = await Promise.all([api.account(), api.users(), fetch('/api/oauth/connections').then((r) => r.json())]);
      setAccount(a);
      setUsers(u);
      setConnections(Array.isArray(cons) ? cons : []);
    } catch (e) {
      setErr(errText(e));
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    try {
      await fn();
      if (ok) setToast(ok);
      await refresh();
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  };

  // ---------- passkeys ----------
  const addPasskey = () =>
    run(async () => {
      const name = prompt('Naam voor deze passkey', deviceName());
      if (name === null) throw new Error('Geannuleerd.');
      const { challengeId, options } = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.passkeyRegisterVerify(challengeId, response, name);
    }, 'Passkey toegevoegd');

  // ---------- wachtwoord ----------
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');

  // ---------- nieuwe gebruiker ----------
  const [nu, setNu] = useState({ username: '', displayName: '', password: '' });

  return (
    <aside className="panel account glass">
      <div className="panel-head">
        <h2>Account</h2>
        <button className="ghost close" onClick={() => setPanel(null)} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <div className="editor-body">
        {toast && <div className="ok-box">{toast}</div>}
        {err && <div className="error-box">{err}</div>}

        <section className="acc-section">
          <h3>{account?.displayName ?? me?.displayName}</h3>
          <div className="muted small-text">Ingelogd als {account?.username ?? me?.username}</div>
        </section>

        <section className="acc-section">
          <h3>Claude koppelen</h3>
          <p className="muted small-text">
            Voeg in claude.ai (Instellingen → Connectors → Eigen connector toevoegen) deze URL toe. Daarna log je hier in en geef je toestemming. Claude kan dan
            meubels voor jullie maken, plaatsen en bekijken.
          </p>
          <div className="copy-row">
            <code>{mcpUrl}</code>
            <button
              className="small"
              onClick={() => {
                navigator.clipboard?.writeText(mcpUrl).then(() => setToast('URL gekopieerd'), () => undefined);
              }}
            >
              <Icon name="copy" size={14} /> Kopieer
            </button>
          </div>
          {connections.map((c) => (
            <div className="acc-row" key={c.clientId}>
              <div>
                <strong>{c.name}</strong>
                <div className="muted small-text">
                  Gekoppeld {fmtDate(c.createdAt)} · laatst gebruikt {fmtDate(c.lastUsed)}
                </div>
              </div>
              <button
                className="small danger"
                onClick={() =>
                  confirm(`Koppeling met “${c.name}” intrekken?`) &&
                  run(() => fetch(`/api/oauth/connections/${encodeURIComponent(c.clientId)}`, { method: 'DELETE' }), 'Koppeling ingetrokken')
                }
              >
                Intrekken
              </button>
            </div>
          ))}
        </section>

        <section className="acc-section">
          <h3>Passkeys</h3>
          <p className="muted small-text">
            Een passkey (Face ID / Touch ID) is de snelste en veiligste manier om in te loggen. Heb je er een, dan telt hij ook als tweede stap na je
            wachtwoord.
          </p>
          {account?.passkeys.length === 0 && <div className="muted small-text">Nog geen passkeys.</div>}
          {account?.passkeys.map((p) => (
            <div className="acc-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <div className="muted small-text">
                  Toegevoegd {fmtDate(p.createdAt)} · laatst gebruikt {fmtDate(p.lastUsed)}
                </div>
              </div>
              <button
                className="small danger"
                onClick={() => confirm(`Passkey “${p.name}” verwijderen?`) && run(() => api.deletePasskey(p.id), 'Passkey verwijderd')}
              >
                Verwijderen
              </button>
            </div>
          ))}
          {passkeySupported ? (
            <button className="primary" onClick={addPasskey}>
              <Icon name="key" /> Passkey toevoegen
            </button>
          ) : (
            <div className="muted small-text">Deze browser ondersteunt geen passkeys.</div>
          )}
        </section>

        <section className="acc-section">
          <h3>Wachtwoord</h3>
          <form
            className="acc-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.changePassword(pwCurrent, pwNext), 'Wachtwoord gewijzigd')) {
                setPwCurrent('');
                setPwNext('');
              }
            }}
          >
            <input type="text" autoComplete="username" value={account?.username ?? ''} readOnly hidden />
            <label className="field">
              <span>Huidig wachtwoord</span>
              <input type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
            </label>
            <label className="field">
              <span>Nieuw wachtwoord (min. 10 tekens)</span>
              <input type="password" autoComplete="new-password" value={pwNext} onChange={(e) => setPwNext(e.target.value)} />
            </label>
            <button disabled={!pwCurrent || pwNext.length < 10}>Wachtwoord wijzigen</button>
          </form>
        </section>

        <section className="acc-section">
          <h3>Gebruikers</h3>
          {users.map((u) => (
            <div className="acc-row" key={u.id}>
              <div>
                <strong>{u.displayName}</strong> <span className="muted small-text">@{u.username}</span>
                <div className="muted small-text">
                  {u.passkeys} passkey{u.passkeys === 1 ? '' : 's'} · sinds {fmtDate(u.createdAt)}
                </div>
              </div>
              {u.id !== me?.id && (
                <div className="row">
                  <button
                    className="small"
                    onClick={() => {
                      const pw = prompt(`Nieuw wachtwoord voor ${u.displayName} (min. 10 tekens)`);
                      if (pw) run(() => api.updateUser(u.id, { password: pw }), 'Wachtwoord ingesteld');
                    }}
                  >
                    Wachtwoord
                  </button>
                  <button
                    className="small danger"
                    onClick={() => confirm(`${u.displayName} verwijderen? Meubels en plaatsingen blijven bestaan.`) && run(() => api.deleteUser(u.id), 'Gebruiker verwijderd')}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
          <form
            className="acc-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.createUser(nu), `${nu.displayName || nu.username} toegevoegd`)) setNu({ username: '', displayName: '', password: '' });
            }}
          >
            <div className="muted small-text">Nieuwe gebruiker</div>
            <div className="grid2">
              <label className="field">
                <span>Naam</span>
                <input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
              </label>
              <label className="field">
                <span>Gebruikersnaam</span>
                <input autoCapitalize="none" autoComplete="off" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value.toLowerCase() })} />
              </label>
            </div>
            <label className="field">
              <span>Tijdelijk wachtwoord (min. 10 tekens)</span>
              <input type="text" autoComplete="off" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
            </label>
            <button className="primary" disabled={!nu.username || nu.password.length < 10}>
              Gebruiker toevoegen
            </button>
          </form>
        </section>
      </div>
      <div className="panel-foot">
        <button
          onClick={async () => {
            await api.logout().catch(() => undefined);
            location.reload();
          }}
        >
          <Icon name="logout" /> Uitloggen
        </button>
      </div>
    </aside>
  );
}
