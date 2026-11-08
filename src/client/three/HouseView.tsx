import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { House, Level } from '../../shared/house';
import { useApp } from '../store';
import {
  STUB,
  buildCeilings,
  buildFences,
  buildFixtures,
  buildFloors,
  buildNeighbors,
  buildOpenings,
  buildRoofs,
  buildShadowProxy,
  buildSkirting,
  buildWalls,
  cutawaySet,
  type WallColorAt,
  type WallMode,
} from './houseMesh';
import { pointInPolygon } from '../../shared/placement';
import { activeFinishes, type RoomFinish } from '../../shared/variants';
import { brickMaterial, groundMaterial, paintMaterial, partyMaterial, skirtingMaterial } from './materials';
import { mergeByMaterial } from './merge';

/** cutaway alleen opnieuw bepalen per 22,5°-sector */
const sector = (az: number) => Math.round(az / (Math.PI / 8));

/** muurlagen + ramen/deuren van een (deel)verdieping als één samengevoegde groep */
function wallGroup(level: Level, cut: number | null, wallColorAt: WallColorAt): THREE.Group {
  const g = new THREE.Group();
  const geos = buildWalls(level, () => cut, wallColorAt);
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    g.add(m);
  };
  add(geos.paint, paintMaterial);
  add(geos.brick, brickMaterial);
  add(geos.party, partyMaterial);
  // ramen en deuren samengevoegd per materiaal (veel minder tekenopdrachten)
  g.add(mergeByMaterial(buildOpenings(level, () => cut)));
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

const LevelMesh = memo(function LevelMesh({ house, index, active, wallMode, azKey, showAll, showLabels, finishes, walking }: {
  house: House;
  index: number;
  active: boolean;
  wallMode: WallMode;
  azKey: number;
  showAll: boolean;
  showLabels: boolean;
  finishes: Record<string, RoomFinish>;
  walking: boolean;
}) {
  const level = house.levels[index];
  // alleen opnieuw opbouwen als de afwerking van déze verdieping verandert (niet bij draaien!)
  const finishKey = JSON.stringify(level.rooms.map((r) => finishes[r.id] ?? null));

  const statics = useMemo(() => {
    const fin: (RoomFinish | null)[] = JSON.parse(finishKey);
    const byRoom = new Map(level.rooms.map((r, i) => [r.id, fin[i]]));
    const wallColorAt: WallColorAt = (x, z) => {
      const room = level.rooms.find((r) => pointInPolygon([x, z], r.polygon));
      return room ? (byRoom.get(room.id)?.wallColor ?? null) : null;
    };
    // binnenmuren: altijd hoog, één keer opbouwen
    const interior = wallGroup({ ...level, walls: level.walls.filter((w) => !w.outside) }, null, wallColorAt);
    // gevels: een hoge én een lage versie; bij draaien wisselen we alleen de zichtbaarheid
    const exterior = level.walls
      .filter((w) => w.outside)
      .map((w) => {
        const one = { ...level, walls: [w] };
        return { id: w.id, full: wallGroup(one, null, wallColorAt), stub: wallGroup(one, STUB, wallColorAt) };
      });
    const skirting = buildSkirting(level);
    const floors = buildFloors(level.rooms, level.elevation, index === 0 ? 0 : 0.2, 0.004, 0, (r) => byRoom.get(r.id)?.floor ?? r.floor);
    const lowFixtures = mergeByMaterial(buildFixtures(level.fixtures.filter((f) => !f.high), level.elevation, true));
    const highFixtures = mergeByMaterial(buildFixtures(level.fixtures.filter((f) => f.high), level.elevation, true));
    return { interior, exterior, skirting, floors, lowFixtures, highFixtures };
  }, [level, index, finishKey]);

  useEffect(
    () => () => {
      disposeTree(statics.interior);
      statics.exterior.forEach((e) => {
        disposeTree(e.full);
        disposeTree(e.stub);
      });
      statics.skirting?.dispose();
      disposeTree(statics.lowFixtures);
      disposeTree(statics.highFixtures);
    },
    [statics],
  );

  // plafonds alleen tijdens het rondlopen
  const ceilings = useMemo(() => (walking && active ? buildCeilings(house, index) : null), [walking, active, house, index]);

  const lowered = useMemo(() => {
    if (walking || showAll || !active) return new Set<string>();
    if (wallMode === 'down') return new Set(statics.exterior.map((e) => e.id));
    if (wallMode === 'cutaway') {
      const az = azKey * (Math.PI / 8);
      return cutawaySet(level, new THREE.Vector2(-Math.sin(az), -Math.cos(az)));
    }
    return new Set<string>();
  }, [walking, showAll, active, wallMode, azKey, level, statics]);

  const showHigh = walking || showAll || !active || wallMode === 'up';

  return (
    <group>
      <primitive object={statics.interior} />
      {statics.exterior.map((e) => (
        <group key={e.id}>
          <primitive object={e.full} visible={!lowered.has(e.id)} />
          <primitive object={e.stub} visible={lowered.has(e.id)} />
        </group>
      ))}
      {statics.skirting && <mesh geometry={statics.skirting} material={skirtingMaterial} receiveShadow />}
      <primitive object={statics.floors} />
      <primitive object={statics.lowFixtures} />
      <primitive object={statics.highFixtures} visible={showHigh} />
      {ceilings && <primitive object={ceilings} />}
      {active && !showAll && showLabels && !walking &&
        level.rooms
          .filter((r) => r.label)
          .map((r) => (
            <Html key={r.id} position={[r.label![0], level.elevation + 0.05, r.label![1]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <div className="room-label">{r.name}</div>
            </Html>
          ))}
    </group>
  );
});

export function HouseView({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const wallMode = useApp((s) => s.wallMode);
  // alleen opnieuw renderen als de sector verandert, niet bij elke graad
  const azKey = useApp((s) => sector(s.azimuth));
  const showLabels = useApp((s) => s.showLabels);
  const variants = useApp((s) => s.variants);
  const activeVariants = useApp((s) => s.active);
  const finishes = useMemo(() => activeFinishes(variants, activeVariants), [variants, activeVariants]);
  const walking = useApp((s) => s.camMode === 'walk');
  const showAll = level === 'all';
  const activeIndex = showAll ? house.levels.length - 1 : level;

  const outdoor = useMemo(() => {
    const g = new THREE.Group();
    g.add(buildFloors(house.outdoor.areas, -0.025, 0, 0, 0.003));
    g.add(buildFences(house.outdoor.fences));
    g.add(buildFixtures(house.outdoor.fixtures, 0, true));
    return mergeByMaterial(g);
  }, [house]);
  const roofs = useMemo(() => mergeByMaterial(buildRoofs(house.roofs)), [house]);
  const neighbors = useMemo(() => buildNeighbors(house), [house]);
  // schaduwmodel: altijd aanwezig, onzichtbaar
  const shadowProxy = useMemo(() => {
    const g = mergeByMaterial(buildShadowProxy(house));
    g.traverse((o) => {
      (o as THREE.Mesh).raycast = () => undefined;
    });
    return g;
  }, [house]);

  const b = house.outdoor.bounds;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(b.x0 + b.x1) / 2, -0.04, (b.z0 + b.z1) / 2]} receiveShadow material={groundMaterial}>
        <planeGeometry args={[(b.x1 - b.x0) * 4, (b.z1 - b.z0) * 4]} />
      </mesh>
      <primitive object={outdoor} />
      <primitive object={shadowProxy} />
      {house.levels.map((_, i) =>
        i <= activeIndex ? (
          <LevelMesh key={i} house={house} index={i} active={i === activeIndex} wallMode={wallMode} azKey={azKey} showAll={showAll} showLabels={showLabels} finishes={finishes} walking={walking} />
        ) : null,
      )}
      {showAll && <primitive object={roofs} />}
      {showAll && <primitive object={neighbors} />}
    </group>
  );
}
