import { useMemo } from 'react';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import { useApp } from '../store';

/**
 * Kamerfocus: in het bovenaanzicht wordt alles buiten de kamer gedimd (vlak met een gat in de vorm
 * van de kamer); in de andere weergaven een groene omlijning op de vloer.
 */
export function RoomFocus({ house }: { house: House }) {
  const roomFocus = useApp((s) => s.roomFocus);
  const top = useApp((s) => s.camMode === 'top');
  const obj = useMemo(() => {
    if (!roomFocus) return null;
    const level = house.levels.find((l) => l.rooms.some((r) => r.id === roomFocus));
    const room = level?.rooms.find((r) => r.id === roomFocus);
    if (!level || !room) return null;
    const g = new THREE.Group();
    if (top) {
      const S = 200;
      const shape = new THREE.Shape([new THREE.Vector2(-S, -S), new THREE.Vector2(S, -S), new THREE.Vector2(S, S), new THREE.Vector2(-S, S)]);
      // gat iets ruimer dan de kamer, zodat de muren rondom zichtbaar blijven
      const hole = new THREE.Path(room.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes.push(hole);
      const mask = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: '#060807', transparent: true, opacity: 0.72, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      mask.rotation.x = -Math.PI / 2;
      mask.position.y = level.elevation + level.storeyHeight + 0.6;
      mask.renderOrder = 10;
      g.add(mask);
    }
    const pts = room.polygon.map(([x, z]) => new THREE.Vector3(x, level.elevation + 0.02, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#a6d8b8' }));
    line.renderOrder = 11;
    g.add(line);
    g.traverse((o) => ((o as THREE.Mesh).raycast = () => undefined));
    return g;
  }, [roomFocus, top, house]);
  return obj ? <primitive object={obj} /> : null;
}
