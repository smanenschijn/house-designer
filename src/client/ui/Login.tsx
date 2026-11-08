import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { ApiError, api, type User } from '../api';

const passkeySupported = typeof window !== 'undefined' && !!window.PublicKeyCredential;

function message(e: unknown) {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Passkey geannuleerd.';
  return e instanceof Error ? e.message : String(e);
}

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const withPasskey = async (pendingToken?: string) => {
    setErr(null);
    setBusy(true);
    try {
      const { challengeId, options } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      onLogin(await api.passkeyLoginVerify(challengeId, response, pendingToken));
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending) return withPasskey(pending);
          setBusy(true);
          setErr(null);
          try {
            const r = await api.login(username.trim(), password);
            if ('needs2fa' in r) {
              setPending(r.pendingToken);
              setBusy(false);
              await withPasskey(r.pendingToken);
              return;
            }
            onLogin(r);
          } catch (e2) {
            setErr(message(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Waalstraat 16</h1>
        <p className="muted">{pending ? 'Bevestig dat jij het bent met je passkey' : 'Log in om verder te gaan'}</p>
        {!pending ? (
          <>
            <label className="field">
              <span>Gebruikersnaam</span>
              <input autoComplete="username webauthn" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Wachtwoord</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="primary block" disabled={busy || !username || !password}>
              {busy ? 'Bezig…' : 'Inloggen'}
            </button>
            {passkeySupported && (
              <>
                <div className="or">
                  <span>of</span>
                </div>
                <button type="button" className="block passkey-btn" disabled={busy} onClick={() => withPasskey()}>
                  🔑 Inloggen met passkey
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button className="primary block" disabled={busy}>
              {busy ? 'Wachten op passkey…' : '🔑 Gebruik passkey'}
            </button>
            <button
              type="button"
              className="ghost block"
              onClick={() => {
                setPending(null);
                setErr(null);
              }}
            >
              Terug
            </button>
          </>
        )}
        {err && <div className="error-box">{err}</div>}
      </form>
    </div>
  );
}
