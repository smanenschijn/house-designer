import type { House } from '../../shared/house';
import { activeVariantFor, describeWallFinish, faceFinish, faceKey, type WallFinish } from '../../shared/variants';
import { faceDirection } from '../../shared/walls';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { Icon } from './Icon';
import { WallFinishPicker } from './WallFinishPicker';

/** Balk voor het geselecteerde muurvlak: verf of behang, alleen deze muur of de hele kamer. */
export function WallBar({ house }: { house: House }) {
  const sel = useApp((s) => s.selectedWall);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const selectWall = useApp((s) => s.selectWall);
  if (!sel) return null;
  const level = house.levels.find((l) => l.id === sel.levelId);
  const wall = level?.walls.find((w) => w.id === sel.wallId);
  const room = level?.rooms.find((r) => r.id === sel.roomId);
  const variant = variants.find((v) => v.id === activeVariantFor(active, sel.roomId));
  if (!level || !wall || !room || !variant) return null;
  const key = faceKey(sel.wallId, sel.side);
  const own = variant.finish.faces?.[key];
  const current = faceFinish(variant.finish, sel.wallId, sel.side);

  const save = async (finish: Record<string, unknown>) => {
    await attempt(() => api.updateVariant(variant.id, { finish } as never));
    await useApp.getState().poll();
  };

  return (
    <div className="wallbar glass">
      <div className="wallbar-head">
        <div>
          <strong>Muur aan de {faceDirection(house, wall, sel.side)}kant</strong>
          <span className="muted small-text">
            {room.name} · {variant.name} · {own ? describeWallFinish(current) : `zoals de kamer (${describeWallFinish(current)})`}
          </span>
        </div>
        <button className="ghost close" onClick={() => selectWall(null)} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <WallFinishPicker value={current} onChange={(w: WallFinish) => save({ faces: { [key]: w } })} />
      <div className="row wrap">
        <button className="small" onClick={() => save({ wall: current, faces: { [key]: null } })} title="Deze afwerking voor alle wanden van de kamer">
          Hele kamer zo
        </button>
        {own && (
          <button className="small" onClick={() => save({ faces: { [key]: null } })}>
            Zoals de kamer
          </button>
        )}
      </div>
    </div>
  );
}
