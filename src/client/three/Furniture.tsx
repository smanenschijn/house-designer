import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import type { Item, Placement } from '../../shared/recipe';
import { pointInPolygon, snapToWalls } from '../../shared/placement';
import { findCollisions } from '../../shared/analysis';
import { api } from '../api';
import { attempt, useApp, visiblePlacements } from '../store';
import { buildRecipe, disposeGroup } from './recipeMesh';
import { mergeByMaterial } from './merge';
import { loadModelObject } from './glbModel';

const DEG = Math.PI / 180;

/** welke plaatsingen botsen (met elkaar, muren of vaste inbouw)? vloerkleden tellen niet mee */
export function useCollisions(house: House, levelId: string | null) {
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  return useMemo(
    () => new Set(levelId ? findCollisions(house, levelId, visiblePlacements({ placements, variants, active }), items).keys() : []),
    [house, levelId, placements, variants, active, items],
  );
}

function PlacedItem({ p, item, elevation, selected, colliding, interactive }: {
  p: Placement;
  item: Item;
  elevation: number;
  selected: boolean;
  colliding: boolean;
  interactive: boolean;
}) {
  const obj = useItemObject(item);
  const y = elevation + (p.y ?? 0) + (item.recipe.elevation ?? 0);
  const { width: w, depth: d, height: h } = item.recipe.size;
  return (
    <group position={[p.x, y, p.z]} rotation-y={p.rotation * DEG} userData={{ placementId: interactive ? p.id : undefined }}>
      {obj && <primitive object={obj} />}
      {(selected || colliding) && (
        <>
          <mesh position={[0, 0.012 - (y - elevation), 0]} rotation-x={-Math.PI / 2} renderOrder={3}>
            <planeGeometry args={[w + 0.08, d + 0.08]} />
            <meshBasicMaterial color={colliding ? '#ee7d74' : '#a6d8b8'} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <lineSegments position={[0, h / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(w + 0.02, h + 0.02, d + 0.02)]} />
            <lineBasicMaterial color={colliding ? '#ee7d74' : '#a6d8b8'} />
          </lineSegments>
          {/* pijl: voorkant */}
          {selected && (
            <mesh position={[0, 0.02 - (y - elevation), d / 2 + 0.12]} rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.07, 3, Math.PI / 2]} />
              <meshBasicMaterial color="#a6d8b8" />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}

/**
 * 3D-object van een meubel: het GLB-model als dat er is, anders het recept
 * (onderdelen samengevoegd per materiaal: 2–4 tekenopdrachten per meubel i.p.v. 10–20).
 */
export function useItemObject(item: Item): THREE.Object3D | null {
  const { invalidate, gl } = useThree();
  const recipeObj = useMemo(() => {
    if (item.model) return null;
    const raw = buildRecipe(item.recipe);
    const merged = mergeByMaterial(raw);
    disposeGroup(raw);
    return merged;
  }, [item.model, item.recipe]);
  useEffect(() => () => {
    if (recipeObj) disposeGroup(recipeObj);
  }, [recipeObj]);
  const [modelObj, setModelObj] = useState<{ file: string; obj: THREE.Object3D } | null>(null);
  const model = item.model;
  useEffect(() => {
    if (!model) return;
    let live = true;
    loadModelObject(model)
      .then((obj) => {
        if (!live) return;
        setModelObj({ file: `${model.file}:${model.scale}:${model.rotation}`, obj });
        // nieuwe geometrie: opnieuw tekenen en schaduw bijwerken
        gl.shadowMap.needsUpdate = true;
        invalidate();
        setTimeout(() => {
          gl.shadowMap.needsUpdate = true;
          invalidate();
        }, 60);
      })
      .catch((e) => console.error('Model laden mislukt', e));
    return () => {
      live = false;
    };
  }, [model, gl, invalidate]);
  if (!model) return recipeObj;
  return modelObj && modelObj.file === `${model.file}:${model.scale}:${model.rotation}` ? modelObj.obj : null;
}

export function FurnitureLayer({ house }: { house: House }) {
  const level = useApp((s) => s.level);
  const allPlacements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const placements = useMemo(() => visiblePlacements({ placements: allPlacements, variants, active }), [allPlacements, variants, active]);
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
  const { gl, camera, controls, scene } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let drag: null | { id: string; pointerId: number; offX: number; offZ: number; moved: boolean; startX: number; startY: number; orig: Placement } = null;
    let tap: null | { x: number; y: number; t: number } = null;
    /** touch: vinger op een (nog niet geselecteerd) meubel, wachten op lang vasthouden */
    let press: null | { id: string; pointerId: number; x: number; y: number; lastX: number; lastY: number; timer: ReturnType<typeof setTimeout> } = null;
    const touches = new Set<number>();
    const LONG_PRESS = 450;

    const setNdc = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    const pickPlacement = (): string | null => {
      const g = groupRef.current;
      if (!g) return null;
      const hits = raycaster.intersectObject(g, true);
      const st = useApp.getState();
      const focusRoom = st.roomFocus ? activeLevel()?.rooms.find((r) => r.id === st.roomFocus) : null;
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) {
          if (o.userData?.placementId) {
            const id = o.userData.placementId as string;
            // focus op een kamer: alleen meubels in die kamer
            if (focusRoom) {
              const p = st.placements.find((q) => q.id === id);
              if (!p || !pointInPolygon([p.x, p.z], focusRoom.polygon)) break;
            }
            return id;
          }
          o = o.parent;
        }
      }
      return null;
    };

    /** welk muurvlak (kant naar een kamer) zit onder de cursor? */
    const pickWall = (x: number, y: number) => {
      const lvl = activeLevel();
      if (!lvl) return null;
      setNdc(x, y);
      const hits = raycaster.intersectObjects(scene.children, true);
      // raycasting negeert zichtbaarheid van ouders: zelf controleren
      const shown = (o: THREE.Object3D | null): boolean => {
        for (let x = o; x; x = x.parent) if (!x.visible) return false;
        return true;
      };
      const h = hits.find((q) => (q.object as THREE.Mesh).isMesh && q.face && shown(q.object));
      if (!h || h.object.userData?.wallLevel !== lvl.id || !h.face) return null;
      const nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (Math.abs(nrm.y) > 0.5) return null; // bovenkant van een muur
      let best: { wallId: string; side: 1 | -1; err: number; n: [number, number] } | null = null;
      for (const w of lvl.walls) {
        const dx = w.b[0] - w.a[0];
        const dz = w.b[1] - w.a[1];
        const len = Math.hypot(dx, dz);
        const dir = [dx / len, dz / len];
        const n: [number, number] = [-dir[1], dir[0]];
        const px = h.point.x - w.a[0];
        const pz = h.point.z - w.a[1];
        const u = px * dir[0] + pz * dir[1];
        const d = px * n[0] + pz * n[1];
        if (u < -0.05 || u > len + 0.05) continue;
        const err = Math.abs(Math.abs(d) - w.thickness / 2);
        if (err > 0.04) continue;
        const side: 1 | -1 = d >= 0 ? 1 : -1;
        if (!best || err < best.err) best = { wallId: w.id, side, err, n };
      }
      if (!best) return null;
      const probe: [number, number] = [h.point.x + best.n[0] * best.side * 0.15, h.point.z + best.n[1] * best.side * 0.15];
      const room = lvl.rooms.find((r) => pointInPolygon(probe, r.polygon));
      if (!room) return null; // buitenkant van de gevel
      const focus = useApp.getState().roomFocus;
      if (focus && room.id !== focus) return null; // focus: alleen muren van die kamer
      return { levelId: lvl.id, wallId: best.wallId, side: best.side, roomId: room.id };
    };

    const activeLevel = () => {
      const lv = useApp.getState().level;
      return lv === 'all' ? null : house.levels[lv];
    };

    const setControls = (on: boolean) => {
      if (controls) (controls as unknown as { enabled: boolean }).enabled = on;
    };

    const cancelPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };

    /** begin met slepen vanaf schermpositie (x, y) */
    const startDrag = (id: string, pointerId: number, x: number, y: number) => {
      const lvl = activeLevel();
      const st = useApp.getState();
      const p = st.placements.find((q) => q.id === id);
      if (!lvl || !p) return false;
      st.select(id);
      plane.constant = -lvl.elevation;
      setNdc(x, y);
      if (!raycaster.ray.intersectPlane(plane, hit)) return false;
      drag = { id, pointerId, offX: hit.x - p.x, offZ: hit.z - p.z, moved: false, startX: x, startY: y, orig: { ...p } };
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* pointer al weg */
      }
      setControls(false);
      return true;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touches.add(e.pointerId);
      // tweede vinger: knijpen/draaien gaat altijd voor
      if (touches.size > 1) {
        cancelPress();
        if (drag && !drag.moved) {
          drag = null;
          setControls(true);
        }
        return;
      }
      if (e.button !== 0) return;
      const st = useApp.getState();
      if (st.camMode === 'walk') return;
      const lvl = activeLevel();
      setNdc(e.clientX, e.clientY);
      const id = lvl && st.editMode ? pickPlacement() : null;
      if (!id) {
        tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
      }
      const direct = e.pointerType !== 'touch' || id === st.selectedId;
      if (direct) {
        // muis, of een al geselecteerd meubel: direct slepen (camera niet laten meebewegen)
        e.stopImmediatePropagation();
        e.preventDefault();
        startDrag(id, e.pointerId, e.clientX, e.clientY);
        return;
      }
      // touch op een ander meubel: de camera mag pannen; lang vasthouden = oppakken
      cancelPress();
      press = {
        id,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        timer: setTimeout(() => {
          if (!press) return;
          const pr = press;
          press = null;
          if (startDrag(pr.id, pr.pointerId, pr.lastX, pr.lastY)) navigator.vibrate?.(15);
        }, LONG_PRESS),
      };
    };

    const onMove = (e: PointerEvent) => {
      if (press && e.pointerId === press.pointerId) {
        press.lastX = e.clientX;
        press.lastY = e.clientY;
        // vinger beweegt: het is pannen, geen oppakken
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress();
        return;
      }
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        useApp.getState().setDragging(drag.id);
      }
      setNdc(e.clientX, e.clientY);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const st = useApp.getState();
      const lvl = activeLevel();
      const p = st.placements.find((x) => x.id === drag!.id);
      const it = p && st.items.find((i) => i.id === p.itemId);
      if (!p || !it || !lvl) return;
      let x = hit.x - drag.offX;
      let z = hit.z - drag.offZ;
      let rot = p.rotation;
      if (st.snap && !e.altKey) {
        x = Math.round(x / 0.01) * 0.01;
        z = Math.round(z / 0.01) * 0.01;
        const sn = snapToWalls({ x, z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot }, lvl);
        x = sn.x;
        z = sn.z;
        rot = sn.rot;
      }
      st.patchPlacementLocal(drag.id, { x, z, rotation: rot });
    };

    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (press && e.pointerId === press.pointerId) {
        // korte tik op een meubel: alleen selecteren
        const pr = press;
        cancelPress();
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) <= 8) useApp.getState().select(pr.id);
        return;
      }
      if (drag && e.pointerId === drag.pointerId) {
        const d = drag;
        drag = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* al vrijgegeven */
        }
        setControls(true);
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
        const st = useApp.getState();
        const wall = st.editMode && st.camMode !== 'walk' ? pickWall(e.clientX, e.clientY) : null;
        if (wall) st.selectWall(wall);
        else {
          st.select(null);
          st.selectWall(null);
        }
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
      cancelPress();
    };
  }, [gl, camera, controls, scene, house, groupRef]);
}
