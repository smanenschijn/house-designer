import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import type { Item, Placement } from '../../shared/recipe';
import { corners, rectsOverlap, snapToWalls, wallRects } from '../../shared/placement';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { buildRecipe, disposeGroup } from './recipeMesh';

const DEG = Math.PI / 180;

function rectOf(p: Placement, it: Item) {
  return { x: p.x, z: p.z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot: p.rotation };
}

/** welke plaatsingen botsen (met elkaar of met muren)? vloerkleden tellen niet mee */
export function useCollisions(house: House, levelId: string | null) {
  const placements = useApp((s) => s.placements);
  const items = useApp((s) => s.items);
  return useMemo(() => {
    const out = new Set<string>();
    if (!levelId) return out;
    const level = house.levels.find((l) => l.id === levelId);
    if (!level) return out;
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const list = placements
      .filter((p) => p.levelId === levelId)
      .map((p) => ({ p, it: itemMap.get(p.itemId) }))
      .filter((x): x is { p: Placement; it: Item } => !!x.it && x.it.recipe.size.height > 0.03);
    const polys = list.map(({ p, it }) => corners(rectOf(p, it)));
    const walls = level.walls.flatMap((w) => wallRects(w));
    // vaste inbouw op vloerniveau (keuken, kasten, trap, …) telt ook als obstakel
    for (const fx of level.fixtures)
      if ((fx.y ?? 0) < 1.0 && fx.recipe.size.height > 0.05)
        walls.push(
          corners({ x: fx.position[0], z: fx.position[1], hw: fx.recipe.size.width / 2, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 }),
        );
    list.forEach(({ p, it }, i) => {
      const elevated = (p.y ?? 0) + (it.recipe.elevation ?? 0);
      for (let j = i + 1; j < list.length; j++) {
        const other = list[j];
        const oElev = (other.p.y ?? 0) + (other.it.recipe.elevation ?? 0);
        // verticaal gescheiden (bijv. wandplank boven dressoir)
        if (elevated >= oElev + other.it.recipe.size.height - 0.01 || oElev >= elevated + it.recipe.size.height - 0.01) continue;
        if (rectsOverlap(polys[i], polys[j], 0.01)) {
          out.add(p.id);
          out.add(other.p.id);
        }
      }
      for (const wr of walls)
        if (rectsOverlap(polys[i], wr, 0.01)) {
          out.add(p.id);
          break;
        }
    });
    return out;
  }, [house, levelId, placements, items]);
}

function PlacedItem({ p, item, elevation, selected, colliding, interactive }: {
  p: Placement;
  item: Item;
  elevation: number;
  selected: boolean;
  colliding: boolean;
  interactive: boolean;
}) {
  const obj = useMemo(() => buildRecipe(item.recipe), [item.recipe]);
  useEffect(() => () => disposeGroup(obj), [obj]);
  const y = elevation + (p.y ?? 0) + (item.recipe.elevation ?? 0);
  const { width: w, depth: d, height: h } = item.recipe.size;
  return (
    <group position={[p.x, y, p.z]} rotation-y={p.rotation * DEG} userData={{ placementId: interactive ? p.id : undefined }}>
      <primitive object={obj} />
      {(selected || colliding) && (
        <>
          <mesh position={[0, 0.012 - (y - elevation), 0]} rotation-x={-Math.PI / 2} renderOrder={3}>
            <planeGeometry args={[w + 0.08, d + 0.08]} />
            <meshBasicMaterial color={colliding ? '#e5484d' : '#2f7cf6'} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <lineSegments position={[0, h / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(w + 0.02, h + 0.02, d + 0.02)]} />
            <lineBasicMaterial color={colliding ? '#e5484d' : '#2f7cf6'} />
          </lineSegments>
          {/* pijl: voorkant */}
          {selected && (
            <mesh position={[0, 0.02 - (y - elevation), d / 2 + 0.12]} rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.07, 3, Math.PI / 2]} />
              <meshBasicMaterial color="#2f7cf6" />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}

export function FurnitureLayer({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const placements = useApp((s) => s.placements);
  const items = useApp((s) => s.items);
  const selectedId = useApp((s) => s.selectedId);
  const activeIndex = level === 'all' ? house.levels.length - 1 : level;
  const activeLevelId = level === 'all' ? null : house.levels[level].id;
  const collisions = useCollisions(house, activeLevelId);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const groupRef = useRef<THREE.Group>(null);
  useFurnitureDrag(house, groupRef);

  return (
    <group ref={groupRef}>
      {placements.map((p) => {
        const li = house.levels.findIndex((l) => l.id === p.levelId);
        const item = itemMap.get(p.itemId);
        if (li < 0 || li > activeIndex || !item) return null;
        return (
          <PlacedItem
            key={p.id}
            p={p}
            item={item}
            elevation={house.levels[li].elevation}
            selected={p.id === selectedId}
            colliding={collisions.has(p.id)}
            interactive={p.levelId === activeLevelId}
          />
        );
      })}
    </group>
  );
}

/**
 * Slepen van meubels. Luistert in de capture-fase zodat de cameracontrols
 * niet mee gaan pannen als je een meubel vastpakt (muis én touch).
 */
function useFurnitureDrag(house: House, groupRef: React.RefObject<THREE.Group | null>) {
  const { gl, camera, controls } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let drag: null | { id: string; pointerId: number; offX: number; offZ: number; moved: boolean; startX: number; startY: number; orig: Placement } = null;
    let tap: null | { x: number; y: number; t: number } = null;

    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    const pickPlacement = (): string | null => {
      const g = groupRef.current;
      if (!g) return null;
      const hits = raycaster.intersectObject(g, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) {
          if (o.userData?.placementId) return o.userData.placementId as string;
          o = o.parent;
        }
      }
      return null;
    };

    const levelElevation = () => {
      const lv = useApp.getState().level;
      return lv === 'all' ? null : house.levels[lv];
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const lvl = levelElevation();
      setNdc(e);
      const id = lvl ? pickPlacement() : null;
      if (!id || !lvl) {
        tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
      }
      // voorkom dat de cameracontrols (zelfde element) ook gaan pannen
      e.stopImmediatePropagation();
      e.preventDefault();
      const st = useApp.getState();
      const p = st.placements.find((x) => x.id === id);
      if (!p) return;
      st.select(id);
      plane.constant = -lvl.elevation;
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      drag = { id, pointerId: e.pointerId, offX: hit.x - p.x, offZ: hit.z - p.z, moved: false, startX: e.clientX, startY: e.clientY, orig: { ...p } };
      el.setPointerCapture(e.pointerId);
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        useApp.getState().setDragging(drag.id);
      }
      setNdc(e);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const st = useApp.getState();
      const lvl = levelElevation();
      const p = st.placements.find((x) => x.id === drag!.id);
      const it = p && st.items.find((i) => i.id === p.itemId);
      if (!p || !it || !lvl) return;
      let x = hit.x - drag.offX;
      let z = hit.z - drag.offZ;
      let rot = p.rotation;
      if (st.snap && !e.altKey) {
        x = Math.round(x / 0.01) * 0.01;
        z = Math.round(z / 0.01) * 0.01;
        const s = snapToWalls({ x, z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot }, lvl);
        x = s.x;
        z = s.z;
        rot = s.rot;
      }
      st.patchPlacementLocal(drag.id, { x, z, rotation: rot });
    };

    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) {
        const d = drag;
        drag = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* al vrijgegeven */
        }
        if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
        const st = useApp.getState();
        st.setDragging(null);
        if (d.moved) {
          const p = st.placements.find((x) => x.id === d.id);
          if (p)
            attempt(() => api.updatePlacement(p.id, { x: p.x, z: p.z, rotation: p.rotation })).then((res) => {
              if (res) useApp.getState().upsertPlacement(res);
              else useApp.getState().upsertPlacement(d.orig);
            });
        }
        return;
      }
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6 && performance.now() - tap.t < 400) {
        useApp.getState().select(null);
      }
      tap = null;
    };

    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl, camera, controls, house, groupRef]);
}
