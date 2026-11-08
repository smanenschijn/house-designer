import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { House, Wall } from '../../shared/house';
import { useApp } from '../store';
import {
  STUB,
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
  type WallMode,
} from './houseMesh';
import { brickMaterial, groundMaterial, paintMaterial, partyMaterial, skirtingMaterial } from './materials';

/** cutaway alleen opnieuw berekenen per 22,5°-sector */
const sector = (az: number) => Math.round(az / (Math.PI / 8));

function LevelMesh({ house, index, active, wallMode, azKey, showAll, showLabels }: {
  house: House;
  index: number;
  active: boolean;
  wallMode: WallMode;
  azKey: number;
  showAll: boolean;
  showLabels: boolean;
}) {
  const level = house.levels[index];
  const objects = useMemo(() => {
    const az = azKey * (Math.PI / 8);
    const camDir = new THREE.Vector2(-Math.sin(az), -Math.cos(az));
    const lowered = active && wallMode === 'cutaway' ? cutawaySet(level, camDir) : new Set<string>();
    // alleen buitenmuren kunnen omlaag; binnenmuren blijven altijd hoog
    const cutFor = (w: Wall): number | null => {
      if (showAll || !active || !w.outside) return null;
      if (wallMode === 'down') return STUB;
      if (wallMode === 'cutaway' && lowered.has(w.id)) return STUB;
      return null;
    };
    return {
      walls: buildWalls(level, cutFor),
      skirting: buildSkirting(level),
      openings: buildOpenings(level, cutFor),
      floors: buildFloors(level.rooms, level.elevation, index === 0 ? 0 : 0.2),
      // plafondelementen (verlaagd plafond, airco) alleen met muren hoog; anders zweven ze boven de kamer
      fixtures: buildFixtures(level.fixtures, level.elevation, showAll || !active || wallMode === 'up'),
    };
  }, [level, index, active, wallMode, azKey, showAll]);

  useEffect(
    () => () => {
      Object.values(objects.walls).forEach((g) => g?.dispose());
      objects.skirting?.dispose();
    },
    [objects],
  );

  return (
    <group>
      {objects.walls.paint && <mesh geometry={objects.walls.paint} material={paintMaterial} receiveShadow />}
      {objects.walls.brick && <mesh geometry={objects.walls.brick} material={brickMaterial} receiveShadow />}
      {objects.walls.party && <mesh geometry={objects.walls.party} material={partyMaterial} receiveShadow />}
      {objects.skirting && <mesh geometry={objects.skirting} material={skirtingMaterial} receiveShadow />}
      <primitive object={objects.openings} />
      <primitive object={objects.floors} />
      <primitive object={objects.fixtures} />
      {active && !showAll && showLabels &&
        level.rooms
          .filter((r) => r.label)
          .map((r) => (
            <Html key={r.id} position={[r.label![0], level.elevation + 0.05, r.label![1]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <div className="room-label">{r.name}</div>
            </Html>
          ))}
    </group>
  );
}

export function HouseView({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const wallMode = useApp((s) => s.wallMode);
  const azimuth = useApp((s) => s.azimuth);
  const showLabels = useApp((s) => s.showLabels);
  const azKey = sector(azimuth);
  const showAll = level === 'all';
  const activeIndex = showAll ? house.levels.length - 1 : level;

  const outdoor = useMemo(() => {
    const g = new THREE.Group();
    g.add(buildFloors(house.outdoor.areas, -0.025, 0, 0, 0.003));
    g.add(buildFences(house.outdoor.fences));
    g.add(buildFixtures(house.outdoor.fixtures, 0, true));
    return g;
  }, [house]);
  const roofs = useMemo(() => buildRoofs(house.roofs), [house]);
  const neighbors = useMemo(() => buildNeighbors(house), [house]);
  // schaduwmodel: altijd aanwezig, onzichtbaar
  const shadowProxy = useMemo(() => buildShadowProxy(house), [house]);

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
          <LevelMesh key={i} house={house} index={i} active={i === activeIndex} wallMode={wallMode} azKey={azKey} showAll={showAll} showLabels={showLabels} />
        ) : null,
      )}
      {showAll && <primitive object={roofs} />}
      {showAll && <primitive object={neighbors} />}
    </group>
  );
}
