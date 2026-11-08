import type { House } from '../../shared/house';
import { roomAt, snapToWalls } from '../../shared/placement';
import { waalstraat16 } from '../../shared/waalstraat16';
import type { Item } from '../../shared/recipe';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { viewState } from '../viewState';

/** Plaats een bibliotheekitem midden in beeld op de actieve verdieping. */
export async function placeItem(house: House, item: Item) {
  const st = useApp.getState();
  if (!st.editMode) st.setEditMode(true);
  let li = st.level === 'all' ? 0 : st.level;
  if (st.level === 'all') st.setLevel(0);
  const level = house.levels[li];
  let x = Math.round(viewState.target.x * 100) / 100;
  let z = Math.round(viewState.target.z * 100) / 100;
  // valt het midden buiten het huis, kies dan het midden van de grootste kamer
  if (!roomAt(level, [x, z])) {
    const biggest = [...level.rooms].sort((a, b) => area(b.polygon) - area(a.polygon))[0];
    const c = biggest.label ?? centroid(biggest.polygon);
    x = c[0];
    z = c[1];
  }
  li = house.levels.indexOf(level);
  const p = await attempt(() => api.createPlacement({ itemId: item.id, levelId: level.id, x, z, rotation: 0 }));
  if (p) {
    useApp.getState().upsertPlacement(p);
    useApp.getState().select(p.id);
  }
}

export async function rotateSelected(delta: number) {
  const st = useApp.getState();
  const p = st.placements.find((x) => x.id === st.selectedId);
  if (!p) return;
  let rotation = (((p.rotation + delta) % 360) + 360) % 360;
  let { x, z } = p;
  // na het draaien opnieuw magnetisch tegen de muur
  const level = waalstraat16.levels.find((l) => l.id === p.levelId);
  const it = st.items.find((i) => i.id === p.itemId);
  if (st.snap && level && it) {
    const s = snapToWalls({ x, z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot: rotation }, level, 0.15);
    if (s.snappedTo.length) ({ x, z, rot: rotation } = s);
  }
  st.patchPlacementLocal(p.id, { rotation, x, z });
  const res = await attempt(() => api.updatePlacement(p.id, { rotation, x, z }));
  if (res) useApp.getState().upsertPlacement(res);
}

export async function nudgeSelected(dx: number, dz: number) {
  const st = useApp.getState();
  const p = st.placements.find((x) => x.id === st.selectedId);
  if (!p) return;
  const x = Math.round((p.x + dx) * 1000) / 1000;
  const z = Math.round((p.z + dz) * 1000) / 1000;
  st.patchPlacementLocal(p.id, { x, z });
  const res = await attempt(() => api.updatePlacement(p.id, { x, z }));
  if (res) useApp.getState().upsertPlacement(res);
}

export async function deleteSelected() {
  const st = useApp.getState();
  const id = st.selectedId;
  if (!id) return;
  st.removePlacement(id);
  await attempt(() => api.deletePlacement(id));
}

export async function duplicateSelected() {
  const st = useApp.getState();
  const p = st.placements.find((x) => x.id === st.selectedId);
  if (!p) return;
  const np = await attempt(() =>
    api.createPlacement({ itemId: p.itemId, levelId: p.levelId, x: p.x + 0.3, z: p.z + 0.3, rotation: p.rotation, y: p.y }),
  );
  if (np) {
    useApp.getState().upsertPlacement(np);
    useApp.getState().select(np.id);
  }
}

function area(poly: [number, number][]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

function centroid(poly: [number, number][]): [number, number] {
  const x = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const z = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [x, z];
}

export const fmtCm = (m: number) => `${Math.round(m * 100)}`;
export const fmtSize = (it: Item) => `${fmtCm(it.recipe.size.width)} × ${fmtCm(it.recipe.size.depth)} × ${fmtCm(it.recipe.size.height)} cm`;
export const fmtPrice = (n: number | null | undefined) =>
  n == null ? '' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
