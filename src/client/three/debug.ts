import * as THREE from 'three';
import { shadowOnlyMaterial } from './materials';

/**
 * Alleen in ontwikkelmodus: diagnose via DOM-events (werkt ook vanuit afgeschermde scriptcontexten).
 *   window.dispatchEvent(new Event('hd-debug-info'))   -> document.body.dataset.hdDebug
 *   window.dispatchEvent(new Event('hd-debug-proxy'))  -> schaduwmodel zichtbaar/onzichtbaar
 */
export function installDebugBridge(scene: THREE.Scene, gl: THREE.WebGLRenderer) {
  const w = window as unknown as { __hdBridge?: boolean };
  if (w.__hdBridge) return;
  w.__hdBridge = true;
  window.addEventListener('hd-debug-info', () => {
    const lights: THREE.DirectionalLight[] = [];
    let proxies = 0, casters = 0;
    scene.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) lights.push(o as THREE.DirectionalLight);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (m.castShadow) casters++;
        if (m.material === shadowOnlyMaterial) proxies++;
      }
    });
    const L = lights[0];
    document.body.dataset.hdDebug = JSON.stringify({
      lights: lights.length,
      pos: L?.position.toArray().map((v) => +v.toFixed(2)),
      target: L?.target.position.toArray(),
      targetParent: !!L?.target.parent,
      intensity: L?.intensity,
      castShadow: L?.castShadow,
      shadowMapEnabled: gl.shadowMap.enabled,
      proxies,
      casters,
    });
  });
  window.addEventListener('hd-debug-proxy', () => {
    const on = !shadowOnlyMaterial.colorWrite;
    shadowOnlyMaterial.colorWrite = on;
    shadowOnlyMaterial.depthWrite = on;
    shadowOnlyMaterial.transparent = on;
    shadowOnlyMaterial.opacity = 0.45;
    shadowOnlyMaterial.color.set('#ff00aa');
    shadowOnlyMaterial.needsUpdate = true;
  });
}
