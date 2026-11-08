import { useMemo } from 'react';
import type { House, Room } from '../../shared/house';
import { polygonArea } from '../../shared/analysis';
import { FLOOR_LABELS, INDOOR_FLOORS, activeVariantFor, defaultVariantId, roomWallFinish, type Variant } from '../../shared/variants';
import { WallFinishPicker } from './WallFinishPicker';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { fmtPrice } from './actions';
import { Icon } from './Icon';

function RoomCard({ room, variants }: { room: Room; variants: Variant[] }) {
  const active = useApp((s) => s.active);
  const placements = useApp((s) => s.placements);
  const items = useApp((s) => s.items);
  const setRoomFocus = useApp((s) => s.setRoomFocus);
  const levelIndex = useApp((s) => (s.level === 'all' ? 0 : s.level));
  const activeId = activeVariantFor(active, room.id);
  const current = variants.find((v) => v.id === activeId) ?? variants[0];

  const stats = useMemo(() => {
    const out = new Map<string, { count: number; price: number }>();
    for (const v of variants) {
      let count = 0;
      let price = 0;
      for (const p of placements)
        if (p.variantId === v.id) {
          count++;
          const it = items.find((i) => i.id === p.itemId);
          if (it && it.meta.status !== 'hebben' && it.meta.price) price += it.meta.price;
        }
      out.set(v.id, { count, price });
    }
    return out;
  }, [variants, placements, items]);

  const refresh = () => useApp.getState().poll();
  const run = async (fn: () => Promise<unknown>) => {
    await attempt(fn);
    await refresh();
  };

  const finish = current?.finish ?? {};
  const floor = finish.floor ?? room.floor;
  const wall = roomWallFinish(finish);
  const ownFaces = Object.keys(finish.faces ?? {}).length;
  const st = current ? stats.get(current.id) : undefined;

  return (
    <div className="room-card">
      <div className="room-card-head">
        <h3>{room.name}</h3>
        <button className="small ghost" onClick={() => setRoomFocus(room.id, levelIndex)} title="Focus op deze kamer">
          <Icon name="focus" size={14} /> Toon
        </button>
      </div>

      <div className="chips">
        {variants.map((v) => (
          <button key={v.id} className={`chip ${v.id === activeId ? 'on' : ''}`} onClick={() => v.id !== activeId && run(() => api.activateVariant(v.id))}>
            {v.name}
            <span className="chip-count">{stats.get(v.id)?.count ?? 0}</span>
          </button>
        ))}
      </div>

      {current && (
        <>
          <div className="room-meta muted small-text">
            {st?.count ?? 0} meubel{st?.count === 1 ? '' : 's'}
            {st?.price ? ` · nog te kopen ${fmtPrice(st.price)}` : ''}
          </div>
          <div className="row wrap">
            <button
              className="small"
              onClick={() => {
                const name = prompt('Naam van de kopie', `${current.name} (kopie)`);
                if (name) run(() => api.createVariant({ roomId: room.id, name, copyFrom: current.id }));
              }}
            >
              <Icon name="copy" size={14} /> Kopie
            </button>
            <button
              className="small"
              onClick={() => {
                const name = prompt('Naam van de nieuwe, lege variant', 'Nieuw idee');
                if (name) run(() => api.createVariant({ roomId: room.id, name }));
              }}
            >
              <Icon name="plus" size={14} /> Leeg
            </button>
            <button
              className="small"
              onClick={() => {
                const name = prompt('Nieuwe naam', current.name);
                if (name && name !== current.name) run(() => api.updateVariant(current.id, { name }));
              }}
            >
              <Icon name="edit" size={14} />
            </button>
            {current.id !== defaultVariantId(room.id) && (
              <button
                className="small danger"
                onClick={() => confirm(`Variant “${current.name}” en de meubels daarin verwijderen?`) && run(() => api.deleteVariant(current.id))}
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>

          <label className="field">
            <span>Vloer</span>
            <select value={floor} onChange={(e) => run(() => api.updateVariant(current.id, { finish: { floor: e.target.value as Room['floor'] } }))}>
              {[...new Set([...INDOOR_FLOORS, floor])].map((f) => (
                <option key={f} value={f}>
                  {FLOOR_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Wanden (hele kamer)</span>
            <WallFinishPicker value={wall} onChange={(w) => run(() => api.updateVariant(current.id, { finish: { wall: w } as never }))} />
            {ownFaces > 0 && (
              <div className="row wrap" style={{ alignItems: 'center' }}>
                <span className="muted small-text">
                  {ownFaces} {ownFaces === 1 ? 'muur heeft' : 'muren hebben'} een eigen afwerking
                </span>
                <button
                  className="small"
                  onClick={() =>
                    run(() =>
                      api.updateVariant(current.id, { finish: { faces: Object.fromEntries(Object.keys(finish.faces ?? {}).map((k) => [k, null])) } as never }),
                    )
                  }
                >
                  Allemaal zoals de kamer
                </button>
              </div>
            )}
            <span className="muted small-text">Tip: tik in beeld op een muur om alleen die muur te verven of te behangen.</span>
          </div>
        </>
      )}
    </div>
  );
}

export function VariantsPanel({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const setLevel = useApp((s) => s.setLevel);
  const variants = useApp((s) => s.variants);
  const setPanel = useApp((s) => s.setPanel);
  const li = level === 'all' ? 0 : level;
  const lv = house.levels[li];
  const rooms = lv.rooms.filter((r) => polygonArea(r.polygon) > 1.5);

  return (
    <aside className="panel variants glass">
      <div className="panel-head">
        <h2>Indelingen</h2>
        <button className="ghost close" onClick={() => setPanel(null)} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <div className="lib-tools">
        <div className="seg wide">
          {house.levels.map((l, i) => (
            <button key={l.id} className={li === i ? 'on' : ''} onClick={() => setLevel(i)}>
              {l.short}
            </button>
          ))}
        </div>
        <p className="muted small-text" style={{ margin: 0 }}>
          Bewaar per kamer meerdere varianten en wissel met één tik. Meubels die je plaatst, horen bij de variant die op dat moment actief is.
        </p>
      </div>
      <div className="editor-body">
        {rooms.map((r) => (
          <RoomCard key={r.id} room={r} variants={variants.filter((v) => v.roomId === r.id)} />
        ))}
      </div>
    </aside>
  );
}
