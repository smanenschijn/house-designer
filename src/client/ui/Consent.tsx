import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useApp } from '../store';
import { Icon } from './Icon';

async function post<T>(path: string, query: string): Promise<T> {
  const res = await fetch(`/api/oauth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, j.error ?? res.statusText);
  return j as T;
}

/** Toestemmingsscherm wanneer Claude (of een andere MCP-client) wil koppelen. */
export function Consent({ query }: { query: string }) {
  const user = useApp((s) => s.user);
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    post<{ clientName: string; redirectHost: string }>('describe', query).then(setInfo, (e) => setErr(e.message));
  }, [query]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const { redirect } = await post<{ redirect: string }>(approve ? 'approve' : 'deny', query);
      window.location.href = redirect;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="glass consent">
        <div className="mark">
          <Icon name="link" size={20} />
        </div>
        <div className="eyebrow">Koppeling</div>
        <h1>{info ? info.clientName : 'App koppelen'}</h1>
        {err ? (
          <div className="error-box">{err}</div>
        ) : (
          <>
            <p className="muted">
              wil toegang tot <strong>Waalstraat 16</strong> als <strong>{user?.displayName}</strong>.
            </p>
            <ul className="consent-list">
              <li>de plattegrond en jullie meubelbibliotheek bekijken</li>
              <li>meubels maken, aanpassen en verwijderen</li>
              <li>meubels in het huis plaatsen en verplaatsen</li>
              <li>afbeeldingen van kamers maken</li>
            </ul>
            {info && <p className="muted small-text">Na toestemming ga je terug naar {info.redirectHost}.</p>}
            <button className="primary block" disabled={busy || !info} onClick={() => decide(true)}>
              Toestaan
            </button>
            <button className="block" disabled={busy || !info} onClick={() => decide(false)}>
              Weigeren
            </button>
          </>
        )}
      </div>
    </div>
  );
}
