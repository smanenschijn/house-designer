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
  buildOpenings,
  buildRoofs,
  buildWalls,
  cutawaySet,
  type WallMode,
} from './houseMesh';
import { groundMaterial, wallMaterial } from './materials';

function quadrant(az: number) {
  // cutaway alleen opnieuw berekenen per 45°-sector
  return Math.round(az / (Math.PI / 8));
}

function LevelMesh({ house, index, active, wallMode, azKey, showAll }: {
  house: House;
  index: number;
  active: boolean;
  wallMode: WallMode;
  azKey: number;
  showAll: boolean;
}) {
  const level = house.levels[index];
  const objects = useMemo(() => {
    const az = azKey * (Math.PI / 8);
    // kijkrichting van camera naar doel in xz
    const camDir = new THREE.Vector2(-Math.sin(az), -Math.cos(az));
    const lowered = active && wallMode === 'cutaway' ? cutawaySet(level, camDir) : new Set<string>();
    const cutFor = (w: Wall): number | null => {
      if (showAll || !active) return null;
      if (wallMode === 'down') return STUB;
      if (wallMode === 'cutaway' && lowered.has(w.id)) return STUB;
      return null;
    };
    const walls = buildWalls(level, cutFor);
    const openings = buildOpenings(level, cutFor);
    const floors = buildFloors(level.rooms, level.elevation, index === 0 ? 0 : 0.2);
    const fixtures = buildFixtures(level.fixtures, level.elevation, showAll || !active || wallMode === 'up');
    return { walls, openings, floors, fixtures };
  }, [level, index, active, wallMode, azKey, showAll]);

  useEffect(
    () => () => {
      objects.walls?.dispose();
    },
    [objects],
  );

  return (
    <group>
      {objects.walls && <mesh geometry={objects.walls} material={wallMaterial} castShadow receiveShadow />}
      <primitive object={objects.openings} />
      <primitive object={objects.floors} />
      <primitive object={objects.fixtures} />
      {active && !showAll &&
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
  const azKey = quadrant(azimuth);
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

  const b = house.outdoor.bounds;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(b.x0 + b.x1) / 2, -0.04, (b.z0 + b.z1) / 2]} receiveShadow material={groundMaterial}>
        <planeGeometry args={[(b.x1 - b.x0) * 3, (b.z1 - b.z0) * 3]} />
      </mesh>
      <primitive object={outdoor} />
      {house.levels.map((_, i) =>
        i <= activeIndex ? (
          <LevelMesh key={i} house={house} index={i} active={i === activeIndex} wallMode={wallMode} azKey={azKey} showAll={showAll} />
        ) : null,
      )}
      {showAll && <primitive object={roofs} />}
    </group>
  );
}
