import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import type { Item, Placement } from '../../shared/recipe';
import { sunPosition } from '../../shared/sun';
import { useApp, visiblePlacements } from '../store';
import { setLampGlow } from './materials';

const DEG = Math.PI / 180;
/** maximaal aantal lichtbronnen tegelijk (elk licht kost rekenwerk per pixel); telefoons minder */
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const MAX_LIGHTS = COARSE ? 10 : 32;
/** deel daarvan voor plafondspots; bij meer spots wordt een deel gebruikt, met evenredig meer licht */
const MAX_SPOTS = COARSE ? 6 : 24;
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

interface DownLight {
  id: string;
  pos: THREE.Vector3;
  /** lichtsterkte-factor als spots zijn samengenomen */
  weight: number;
}

/** inbouwspot: smalle lichtbundel recht naar beneden */
function Downlight({ pos, weight }: { pos: THREE.Vector3; weight: number }) {
  const { light, target } = useMemo(() => {
    const target = new THREE.Object3D();
    target.position.set(pos.x, pos.y - 2, pos.z);
    const light = new THREE.SpotLight(WARM, 7 * weight, 6, 0.6, 0.85, 2);
    light.position.copy(pos);
    light.target = target;
    return { light, target };
  }, [pos, weight]);
  useEffect(() => () => light.dispose(), [light]);
  return (
    <>
      <primitive object={target} />
      <primitive object={light} />
    </>
  );
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

  // plafondspots (vaste inbouw met afwerking “licht” hoog in de kamer)
  const spots = useMemo<DownLight[]>(() => {
    if (!on) return [];
    const activeIndex = level === 'all' ? house.levels.length - 1 : level;
    const all: DownLight[] = [];
    // de actieve verdieping eerst
    const order = house.levels.map((_, i) => i).filter((i) => i <= activeIndex).sort((a, b) => (a === activeIndex ? -1 : b === activeIndex ? 1 : b - a));
    for (const li of order) {
      const lv = house.levels[li];
      for (const fx of lv.fixtures) {
        if ((fx.y ?? 0) < 2 || !Object.values(fx.recipe.materials).some((m) => m.finish === 'light')) continue;
        all.push({ id: fx.id, pos: new THREE.Vector3(fx.position[0], lv.elevation + (fx.y ?? 0) - 0.02, fx.position[1]), weight: 1 });
      }
    }
    if (all.length <= MAX_SPOTS) return all;
    // te veel: elke n-de spot, met n keer zoveel licht (totaal blijft gelijk)
    const n = Math.ceil(all.length / MAX_SPOTS);
    return all.filter((_, i) => i % n === 0).map((s) => ({ ...s, weight: n }));
  }, [on, level, house]);

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
    return out.sort((a, b) => Math.abs(a.pos.y - activeY - 1) - Math.abs(b.pos.y - activeY - 1)).slice(0, Math.max(4, MAX_LIGHTS - spots.length));
  }, [on, level, placements, variants, active, items, house, spots.length]);

  return (
    <>
      {spots.map((s) => (
        <Downlight key={s.id} pos={s.pos} weight={s.weight} />
      ))}
      {lights.map((l) => (
        <pointLight key={l.id} position={l.pos} color={WARM} intensity={l.ceiling ? 9 : 5} distance={l.ceiling ? 7 : 5.5} decay={2} />
      ))}
    </>
  );
}
