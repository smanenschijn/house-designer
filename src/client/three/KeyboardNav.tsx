import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useApp } from '../store';
import { keyState } from '../keyState';

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Pijltjestoetsen: beeld schuiven (omhoog/omlaag/links/rechts).
 * Spatiebalk ingedrukt + pijltjes: draaien (links/rechts) en kantelen (omhoog/omlaag).
 * Met een geselecteerd meubel verschuiven de pijltjes het meubel (zie SelectionBar).
 */
export function KeyboardNav() {
  const { camera, controls, invalidate, size } = useThree();
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Space') {
        keyState.space = true;
        e.preventDefault(); // geen knop activeren of pagina scrollen
        return;
      }
      if (!ARROWS.has(e.key)) return;
      if (useApp.getState().selectedId && !keyState.space) return; // meubel verschuiven
      e.preventDefault();
      keys.current.add(e.key);
      invalidate();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') keyState.space = false;
      keys.current.delete(e.key);
    };
    const blur = () => {
      keyState.space = false;
      keys.current.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const k = keys.current;
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!k.size || !c) return;
    const dt = Math.min(delta, 0.05);
    const h = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const v = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    const offset = camera.position.clone().sub(c.target);
    if (keyState.space) {
      // draaien om het doelpunt en kantelen
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta -= h * 1.5 * dt;
      sph.phi = THREE.MathUtils.clamp(sph.phi - v * 0.9 * dt, c.minPolarAngle, c.maxPolarAngle);
      offset.setFromSpherical(sph);
      camera.position.copy(c.target).add(offset);
    } else {
      // schuiven in schermrichting, snelheid volgens wat er in beeld is
      const az = Math.atan2(offset.x, offset.z);
      const visible = (camera as THREE.OrthographicCamera).isOrthographicCamera
        ? size.height / (camera as THREE.OrthographicCamera).zoom
        : 2 * offset.length() * Math.tan(((camera as THREE.PerspectiveCamera).fov / 2) * (Math.PI / 180));
      const speed = visible * 0.65 * dt;
      const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const fwd = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
      const move = right.multiplyScalar(h * speed).add(fwd.multiplyScalar(v * speed));
      c.target.add(move);
      camera.position.add(move);
    }
    c.update();
    invalidate();
  });

  return null;
}
