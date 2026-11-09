import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import type { Item, Placement } from '../../shared/recipe';
import { sunPosition } from '../../shared/sun';
import { useApp, visiblePlacements } from '../store';
import { setLampGlow } from './materials';

const DEG = Math.PI / 180;
/** maximaal aantal lichtbronnen tegelijk (elk licht kost rekenwerk per pixel) */
const MAX_LIGHTS = 14;
const WARM = new THREE.Color('#ffcf98');

/** zonhoogte in graden voor de ingestelde datum/tijd */
export function useSunElevation() {
  const sun = useApp((s) => s.sun);
  return useMemo(() => {
    const [y, m, d] = sun.date.split('-').map(Number);
    return sunPosition(new Date(y, m - 1, d, Math.floor(sun.minutes / 60), sun.minutes % 60)).elevation;
  }, [sun]);
}

/** branden de lampen? automatisch na zonsondergang, of handmatig aan/uit */
export function useLampsOn() {
  const mode = useApp((s) => s.lamps);
  const elevation = useSunElevation();
  return mode === 'on' || (mode === 'auto' && elevation < 3);
}

/** is dit een lamp, en waar zit de lichtbron (lokaal, t.o.v. het midden onderaan)? */
function lampSource(it: Item): { local: THREE.Vector3; ceiling: boolean } | null {
  const r = it.recipe;
  const lightMats = new Set(Object.entries(r.materials).filter(([, m]) => m.finish === 'light').map(([k]) => k));
  const parts = r.parts.filter((p) => lightMats.has(p.material));
  if (!parts.length && it.category !== 'verlichting') return null;
  const local = new THREE.Vector3();
  if (parts.length) {
    for (const p of parts) local.add(new THREE.Vector3(...(p.position ?? [0, 0, 0])));
    local.divideScalar(parts.length);
  } else local.set(0, r.size.height * 0.85, 0);
  const ceiling = r.mount === 'ceiling' || (r.elevation ?? 0) > 1.5;
  // lichtpunt net onder de kap, zodat de kap zelf niet in de weg zit
  local.y -= ceiling ? 0.12 : 0.05;
  return { local, ceiling };
}

interface LampLight {
  id: string;
  pos: THREE.Vector3;
  ceiling: boolean;
}

/**
 * Avondsfeer: lampen (onderdelen met afwerking “licht”, of meubels in de categorie verlichting)
 * geven warm licht en hun kappen gloeien op.
 */
export function Lamps({ house }: { house: House }) {
  const on = useLampsOn();
  const level = useApp((s) => s.level);
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  const { invalidate } = useThree();

  useEffect(() => {
    setLampGlow(on ? 2.4 : 0.35);
    invalidate();
  }, [on, invalidate]);

  const lights = useMemo<LampLight[]>(() => {
    if (!on) return [];
    const activeIndex = level === 'all' ? house.levels.length - 1 : level;
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const out: LampLight[] = [];
    for (const p of visiblePlacements({ placements, variants, active }) as Placement[]) {
      const li = house.levels.findIndex((l) => l.id === p.levelId);
      if (li < 0 || li > activeIndex) continue;
      const it = itemMap.get(p.itemId);
      const src = it && lampSource(it);
      if (!src) continue;
      const y = house.levels[li].elevation + (p.y ?? 0) + (it.recipe.elevation ?? 0);
      const pos = src.local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation * DEG).add(new THREE.Vector3(p.x, y, p.z));
      out.push({ id: p.id, pos, ceiling: src.ceiling });
    }
    // bij te veel lampen: die op de actieve verdieping gaan voor
    const activeY = house.levels[activeIndex].elevation;
    return out.sort((a, b) => Math.abs(a.pos.y - activeY - 1) - Math.abs(b.pos.y - activeY - 1)).slice(0, MAX_LIGHTS);
  }, [on, level, placements, variants, active, items, house]);

  return (
    <>
      {lights.map((l) => (
        <pointLight key={l.id} position={l.pos} color={WARM} intensity={l.ceiling ? 9 : 5} distance={l.ceiling ? 7 : 5.5} decay={2} />
      ))}
    </>
  );
}
