import * as THREE from 'three';
import { shadowOnlyMaterial } from './materials';

/**
 * Alleen in ontwikkelmodus: diagnose via DOM-events (werkt ook vanuit afgeschermde scriptcontexten).
 *   window.dispatchEvent(new Event('hd-debug-info'))   -> document.body.dataset.hdDebug
 *   window.dispatchEvent(new Event('hd-debug-proxy'))  -> schaduwmodel zichtbaar/onzichtbaar
 */
export function installDebugBridge(scene: THREE.Scene, gl: THREE.WebGLRenderer, getCamera: () => THREE.Camera) {
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
  // synchrone meting (werkt ook als het venster verborgen is): render-CPU-tijd, tekenopdrachten, bouwtijden
  window.addEventListener('hd-debug-static', async () => {
    const cam = getCamera();
    const t0 = performance.now();
    gl.info.autoReset = false;
    gl.info.reset();
    gl.render(scene, cam);
    const first = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    const N = 10;
    const t1 = performance.now();
    for (let i = 0; i < N; i++) gl.render(scene, cam);
    gl.getContext().finish();
    const renderMs = (performance.now() - t1) / N;
    gl.info.autoReset = true;
    // bouwtijden van het huis
    const { waalstraat16 } = await import('../../shared/waalstraat16');
    const hm = await import('./houseMesh');
    const time = (fn: () => unknown) => {
      const s = performance.now();
      fn();
      return +(performance.now() - s).toFixed(1);
    };
    const lv = waalstraat16.levels[0];
    document.body.dataset.hdStatic = JSON.stringify({
      firstRenderMs: +(t1 - t0).toFixed(1),
      renderCpuMs: +renderMs.toFixed(2),
      drawCalls: first.calls,
      triangles: first.triangles,
      shadowMap: (scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined)?.shadow.mapSize.x,
      dpr: gl.getPixelRatio(),
      size: [gl.domElement.width, gl.domElement.height],
      build_wallsBG_ms: time(() => hm.buildWalls(lv, () => null)),
      build_openingsBG_ms: time(() => hm.buildOpenings(lv, () => null)),
      build_skirtingBG_ms: time(() => hm.buildSkirting(lv)),
      build_fixturesBG_ms: time(() => hm.buildFixtures(lv.fixtures, 0, true)),
      build_shadowProxy_ms: time(() => hm.buildShadowProxy(waalstraat16)),
    });
  });
  // prestatiemeting: 3 s lang frametijden en tekenopdrachten per frame
  window.addEventListener('hd-debug-perf', () => {
    const times: number[] = [];
    const calls: number[] = [];
    const tris: number[] = [];
    gl.info.autoReset = false;
    gl.info.reset();
    let last = performance.now();
    const end = last + 3000;
    const tick = () => {
      const now = performance.now();
      times.push(now - last);
      calls.push(gl.info.render.calls);
      tris.push(gl.info.render.triangles);
      gl.info.reset();
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else {
        gl.info.autoReset = true;
        times.shift();
        const sorted = [...times].sort((a, b) => a - b);
        let meshes = 0;
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes++;
        });
        document.body.dataset.hdPerf = JSON.stringify({
          frames: times.length,
          fps: Math.round(1000 / (times.reduce((a, b) => a + b, 0) / times.length)),
          avgMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
          p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
          maxMs: +sorted[sorted.length - 1].toFixed(1),
          drawCalls: Math.round(calls.reduce((a, b) => a + b, 0) / calls.length),
          triangles: Math.round(tris.reduce((a, b) => a + b, 0) / tris.length),
          meshes,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          programs: gl.info.programs?.length,
          dpr: gl.getPixelRatio(),
        });
      }
    };
    requestAnimationFrame(tick);
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
