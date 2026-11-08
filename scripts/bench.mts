// Benchmark (zonder browser): bouwtijden en aantal objecten/tekenopdrachten.
// Gebruik: npx tsx scripts/bench.mts
import * as THREE from 'three';

// minimaal nep-canvas voor de procedurele texturen
const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
(globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const { waalstraat16: house } = await import('../src/shared/waalstraat16');
const hm = await import('../src/client/three/houseMesh');
const { buildRecipe } = await import('../src/client/three/recipeMesh');
const { TEMPLATES } = await import('../src/shared/templates');
const { mergeByMaterial } = await import('../src/client/three/merge');

const time = (fn: () => unknown, n = 5) => {
  fn(); // opwarmen
  const s = performance.now();
  for (let i = 0; i < n; i++) fn();
  return +((performance.now() - s) / n).toFixed(2);
};
const countMeshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) n++;
  });
  return n;
};

const lv = house.levels[0];
const camDir = new THREE.Vector2(0.7, -0.7);
const lowered = hm.cutawaySet(lv, camDir);
const cut = (w: { id: string; outside?: unknown }) => (w.outside && lowered.has(w.id) ? 0.35 : null);

const out: Record<string, unknown> = {};
out['opbouw BG bij draaien (ms)'] = time(() => {
  hm.buildWalls(lv, cut as never, () => null);
  hm.buildSkirting(lv);
  hm.buildOpenings(lv, cut as never);
  hm.buildFloors(lv.rooms, 0, 0);
  hm.buildFixtures(lv.fixtures, 0, true);
});
out['schaduwmodel (ms)'] = time(() => hm.buildShadowProxy(house), 3);

// objecten in beeld (BG-weergave): muren (3 lagen), plinten, ramen/deuren, vloeren, inbouw, tuin, schaduwmodel
const openings = countMeshes(hm.buildOpenings(lv, cut as never));
const floors = countMeshes(hm.buildFloors(lv.rooms, 0, 0));
const fixtures = countMeshes(hm.buildFixtures(lv.fixtures, 0, true));
const outdoorFloors = countMeshes(hm.buildFloors(house.outdoor.areas, 0, 0));
const outdoorFx = countMeshes(hm.buildFixtures(house.outdoor.fixtures, 0, true));
const fences = countMeshes(hm.buildFences(house.outdoor.fences));
const proxy = countMeshes(hm.buildShadowProxy(house));
// meubels: 14 testmeubels uit sjablonen
const furnitureParts = ['hoekbank', 'salontafel', 'vloerkleed', 'fauteuil', 'tafel', 'stoel', 'stoel', 'stoel', 'plant', 'boekenkast', 'bed', 'kast', 'bed', 'bureau']
  .map((id) => countMeshes(buildRecipe(TEMPLATES.find((t) => t.id === id)!.build(TEMPLATES.find((t) => t.id === id)!.defaults))))
  .reduce((a, b) => a + b, 0);
out['objecten'] = { muren: 4, ramen_deuren: openings, vloeren: floors, inbouw: fixtures, tuin: outdoorFloors + outdoorFx + fences, schaduwmodel: proxy, meubels: furnitureParts };
const visible = 4 + openings + floors + fixtures + outdoorFloors + outdoorFx + fences + furnitureParts;
out['tekenopdrachten per frame (schatting)'] = { beeld: visible, schaduwpas: proxy + fixtures + furnitureParts + outdoorFx + fences + openings, AO_pas: visible };
// ---- nieuw: samengevoegd per materiaal ----
const m = (o: THREE.Object3D) => countMeshes(mergeByMaterial(o));
const nOpen = m(hm.buildOpenings(lv, cut as never));
const nFix = m(hm.buildFixtures(lv.fixtures, 0, true));
const og = new THREE.Group();
og.add(hm.buildFloors(house.outdoor.areas, 0, 0));
og.add(hm.buildFences(house.outdoor.fences));
og.add(hm.buildFixtures(house.outdoor.fixtures, 0, true));
const nOut = m(og);
const nProxy = m(hm.buildShadowProxy(house));
const nFurn = ['hoekbank', 'salontafel', 'vloerkleed', 'fauteuil', 'tafel', 'stoel', 'stoel', 'stoel', 'plant', 'boekenkast', 'bed', 'kast', 'bed', 'bureau']
  .map((id) => m(buildRecipe(TEMPLATES.find((t) => t.id === id)!.build(TEMPLATES.find((t) => t.id === id)!.defaults))))
  .reduce((a, b) => a + b, 0);
const exterior = lv.walls.filter((w) => w.outside).length;
const visibleNew = 3 + exterior * 4 + nOpen + floors + nFix + nOut + nFurn;
out['NA optimalisatie'] = {
  'opbouw bij draaien (ms)': 0,
  objecten: { ramen_deuren: nOpen, inbouw: nFix, tuin: nOut, schaduwmodel: nProxy, meubels: nFurn },
  'tekenopdrachten per frame (schatting)': { beeld: visibleNew, schaduwpas: 'alleen bij wijziging' },
};
console.log(JSON.stringify(out, null, 2));
