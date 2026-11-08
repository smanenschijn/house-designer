import { useMemo } from 'react';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import { faceExtent } from '../../shared/walls';
import { useApp } from '../store';

/** Markeert het geselecteerde muurvlak met een zacht groen vlak en een rand. */
export function WallHighlight({ house }: { house: House }) {
  const sel = useApp((s) => s.selectedWall);
  const obj = useMemo(() => {
    if (!sel) return null;
    const level = house.levels.find((l) => l.id === sel.levelId);
    const wall = level?.walls.find((w) => w.id === sel.wallId);
    const room = level?.rooms.find((r) => r.id === sel.roomId);
    if (!level || !wall || !room) return null;
    const ext = faceExtent(wall, sel.side, room);
    if (!ext) return null;
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const len = Math.hypot(dx, dz);
    const dir = new THREE.Vector2(dx / len, dz / len);
    const n = new THREE.Vector2(-dir.y, dir.x);
    const h = Math.min(level.ceilingHeight, wall.height ?? level.storeyHeight);
    const w = ext[1] - ext[0];
    const g = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: '#a6d8b8', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    plane.renderOrder = 4;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: '#a6d8b8' }));
    g.add(plane, edges);
    const uc = (ext[0] + ext[1]) / 2;
    const off = wall.thickness / 2 + 0.006;
    g.position.set(wall.a[0] + dir.x * uc + n.x * off * sel.side, level.elevation + h / 2, wall.a[1] + dir.y * uc + n.y * off * sel.side);
    g.rotation.y = Math.atan2(-dir.y, dir.x);
    g.traverse((o) => ((o as THREE.Mesh).raycast = () => undefined));
    return g;
  }, [sel, house]);
  return obj ? <primitive object={obj} /> : null;
}
