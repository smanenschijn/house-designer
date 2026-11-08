import { useMemo, useState } from 'react';
import type { House } from '../../shared/house';
import { CATEGORIES, STATUSES, STATUS_LABELS, type Item, type ItemStatus } from '../../shared/recipe';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { recipeThumbnail } from '../three/thumbnail';
import { fmtPrice, fmtSize, placeItem } from './actions';
import { Icon } from './Icon';

function Thumb({ item }: { item: Item }) {
  const src = useMemo(() => {
    try {
      return recipeThumbnail(`${item.id}:${item.updatedAt}`, item.recipe);
    } catch {
      return '';
    }
  }, [item.id, item.updatedAt, item.recipe]);
  return <img className="thumb" src={src} alt="" loading="lazy" />;
}

export function LibraryPanel({ house }: { house: House }) {
  const items = useApp((s) => s.items);
  const placements = useApp((s) => s.placements);
  const users = useApp((s) => s.users);
  const setPanel = useApp((s) => s.setPanel);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ItemStatus | 'alle'>('alle');
  const [cat, setCat] = useState<string>('alle');

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of placements) m.set(p.itemId, (m.get(p.itemId) ?? 0) + 1);
    return m;
  }, [placements]);

  const filtered = items.filter(
    (it) =>
      (status === 'alle' ? it.meta.status !== 'afgevallen' : it.meta.status === status) &&
      (cat === 'alle' || it.category === cat) &&
      (!q || `${it.name} ${it.meta.shop ?? ''} ${it.category}`.toLowerCase().includes(q.toLowerCase())),
  );

  const placedTotal = useMemo(() => {
    let sum = 0;
    for (const p of placements) {
      const it = items.find((i) => i.id === p.itemId);
      if (it && it.meta.status !== 'hebben' && it.meta.price) sum += it.meta.price;
    }
    return sum;
  }, [placements, items]);

  const userName = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? '';

  return (
    <aside className="panel library glass">
      <div className="panel-head">
        <h2>Bibliotheek</h2>
        <button className="ghost close" onClick={() => setPanel(null)} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <div className="lib-tools">
        <input className="search" placeholder="Zoeken…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | 'alle')}>
            <option value="alle">Alle (zonder afgevallen)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="alle">Alle categorieën</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button className="primary block" onClick={() => setPanel('editor', null)}>
          <Icon name="plus" /> Nieuw meubel
        </button>
      </div>

      <div className="lib-list">
        {filtered.length === 0 && <p className="muted pad">Nog niets gevonden. Voeg een meubel toe met “Nieuw meubel”.</p>}
        {filtered.map((it) => (
          <div key={it.id} className={`card status-${it.meta.status}`}>
            <Thumb item={it} />
            <div className="card-body">
              <div className="card-title">{it.name}</div>
              <div className="card-sub">{fmtSize(it)}</div>
              <div className="card-meta">
                <span className={`badge b-${it.meta.status}`}>{STATUS_LABELS[it.meta.status]}</span>
                {it.meta.price != null && <span>{fmtPrice(it.meta.price)}</span>}
                {it.meta.shop && <span className="muted">{it.meta.shop}</span>}
                {counts.get(it.id) ? <span className="muted">{counts.get(it.id)}× geplaatst</span> : null}
              </div>
              {it.createdBy && <div className="card-by muted">door {userName(it.createdBy)}</div>}
              <div className="card-actions">
                <button
                  className="primary small"
                  onClick={() => {
                    placeItem(house, it);
                    if (window.innerWidth < 760) setPanel(null);
                  }}
                >
                  Plaatsen
                </button>
                <button className="small" onClick={() => setPanel('editor', it.id)}>
                  Bewerken
                </button>
                {it.meta.url && (
                  <a className="small linkbtn" href={it.meta.url} target="_blank" rel="noreferrer" title="Productpagina">
                    <Icon name="link" size={14} />
                  </a>
                )}
                <button
                  className="small danger"
                  onClick={async () => {
                    const n = counts.get(it.id) ?? 0;
                    if (!confirm(`“${it.name}” verwijderen${n ? ` (en ${n} plaatsing${n > 1 ? 'en' : ''})` : ''}?`)) return;
                    useApp.getState().removeItem(it.id);
                    await attempt(() => api.deleteItem(it.id));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {placedTotal > 0 && (
        <div className="lib-foot">
          <span>Nog te kopen in het huis</span> <strong>{fmtPrice(placedTotal)}</strong>
        </div>
      )}
    </aside>
  );
}
