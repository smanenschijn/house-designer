import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { House, Level, V2 } from '../../shared/house';
import { corners, pointInPolygon, wallRects } from '../../shared/placement';
import { roomBox } from '../../shared/analysis';
import { useApp, visiblePlacements } from '../store';
import { viewState } from '../viewState';
import { walkInput } from '../walkInput';

const EYE = 1.62;
const RADIUS = 0.22;
const WALK = 1.4; // m/s
const RUN = 2.8;

/** dichtstbijzijnde punt op een (convexe) polygoon en of p erbinnen ligt */
function closestOnPolygon(p: V2, poly: V2[]): { q: V2; inside: boolean } {
  const inside = pointInPolygon(p, poly);
  let best: V2 = poly[0];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz || 1)));
    const q: V2 = [a[0] + abx * t, a[1] + abz * t];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { q: best, inside };
}

/** schuif een cirkel (speler) uit alle obstakels */
function resolve(p: V2, obstacles: V2[][]): V2 {
  let [x, z] = p;
  for (let iter = 0; iter < 3; iter++) {
    for (const poly of obstacles) {
      const { q, inside } = closestOnPolygon([x, z], poly);
      const dx = x - q[0];
      const dz = z - q[1];
      const d = Math.hypot(dx, dz);
      if (inside) {
        // binnenin: naar buiten via dichtstbijzijnde rand
        const nx = d > 1e-6 ? -dx / d : 1;
        const nz = d > 1e-6 ? -dz / d : 0;
        x = q[0] + nx * RADIUS;
        z = q[1] + nz * RADIUS;
      } else if (d < RADIUS) {
        x = q[0] + (dx / (d || 1)) * RADIUS;
        z = q[1] + (dz / (d || 1)) * RADIUS;
      }
    }
  }
  return [x, z];
}

function startPoint(level: Level, focusRoom: string | null): V2 {
  const room = (focusRoom && level.rooms.find((r) => r.id === focusRoom)) || null;
  if (room) {
    const b = roomBox(room);
    return room.label ?? [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
  }
  const t: V2 = [viewState.target.x, viewState.target.z];
  if (level.rooms.some((r) => pointInPolygon(t, r.polygon))) return t;
  const biggest = [...level.rooms].sort((a, b) => {
    const ba = roomBox(a);
    const bb = roomBox(b);
    return (bb.x1 - bb.x0) * (bb.z1 - bb.z0) - (ba.x1 - ba.x0) * (ba.z1 - ba.z0);
  })[0];
  return biggest.label ?? [0, 0];
}

export function WalkControls({ house }: { house: House }) {
  const { camera, gl } = useThree();
  const level = useApp((s) => s.level);
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  const li = level === 'all' ? 0 : level;
  const lv = house.levels[li];
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const pos = useRef<V2>([0, 0]);
  const started = useRef<number | null>(null);

  // obstakels: muren (deuren open), vaste inbouw en meubels hoger dan 30 cm
  const obstacles = useMemo(() => {
    const out: V2[][] = lv.walls.flatMap((w) => wallRects(w));
    for (const fx of lv.fixtures)
      if ((fx.y ?? 0) < 1.2 && fx.recipe.size.height > 0.3)
        out.push(corners({ x: fx.position[0], z: fx.position[1], hw: fx.recipe.size.width / 2, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 }));
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const p of visiblePlacements({ placements, variants, active })) {
      if (p.levelId !== lv.id) continue;
      const it = itemMap.get(p.itemId);
      if (!it || it.recipe.size.height < 0.3) continue;
      out.push(corners({ x: p.x, z: p.z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot: p.rotation }));
    }
    return out;
  }, [lv, placements, variants, active, items]);

  // start (of andere verdieping): positie en kijkrichting
  useEffect(() => {
    const st = useApp.getState();
    const inRoom = started.current !== null && lv.rooms.some((r) => pointInPolygon(pos.current, r.polygon));
    if (!inRoom) pos.current = startPoint(lv, st.focusRoom);
    if (started.current === null) {
      // kijk dezelfde kant op als de camera ervoor
      yaw.current = st.azimuth;
      pitch.current = -0.08;
    }
    pos.current = resolve(pos.current, obstacles);
    started.current = li;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [li]);

  // toetsenbord en muis
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      keys.current.add(e.code);
      if (e.code === 'Escape' && document.pointerLockElement !== el) useApp.getState().setCamMode('persp');
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      yaw.current -= e.movementX * 0.0022;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - e.movementY * 0.0022));
    };
    // muis: klik = muis vastzetten; touch/pen: slepen = rondkijken
    let drag: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement !== el) el.requestPointerLock?.();
        return;
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      yaw.current -= (e.clientX - drag.x) * 0.005;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - (e.clientY - drag.y) * 0.005));
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', onMouseMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    const k = keys.current;
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (document.pointerLockElement === el) document.exitPointerLock();
      k.clear();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const k = keys.current;
    // kijkbeweging van touch-overlay
    if (walkInput.lookX || walkInput.lookY) {
      yaw.current -= walkInput.lookX * 0.005;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - walkInput.lookY * 0.005));
      walkInput.lookX = 0;
      walkInput.lookY = 0;
    }
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + walkInput.moveY;
    let side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + walkInput.moveX;
    const len = Math.hypot(fwd, side);
    if (len > 1) {
      fwd /= len;
      side /= len;
    }
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * Math.min(dt, 0.05);
    if (fwd || side) {
      // kijkrichting in xz: yaw = azimut van de camera (camera kijkt naar -(sin, cos))
      const fx = -Math.sin(yaw.current);
      const fz = -Math.cos(yaw.current);
      const rx = -fz;
      const rz = fx;
      const next: V2 = [pos.current[0] + (fx * fwd + rx * side) * speed, pos.current[1] + (fz * fwd + rz * side) * speed];
      pos.current = resolve(next, obstacles);
    }
    camera.position.set(pos.current[0], lv.elevation + EYE, pos.current[1]);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    viewState.target.set(pos.current[0], lv.elevation, pos.current[1]);
    if (Math.abs(yaw.current - useApp.getState().azimuth) > 0.02) useApp.getState().setAzimuth(yaw.current);
  });

  return null;
}
