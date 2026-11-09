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
  // z-fighting opsporen: zichtbare driehoeken (wereldcoördinaten) die in hetzelfde vlak liggen én overlappen
  window.addEventListener('hd-debug-zfight', () => {
    type Tri = { p: THREE.Vector3[]; n: THREE.Vector3; d: number; mesh: string; c: THREE.Vector3; key: string; look: string | null };
    const buckets = new Map<string, Tri[]>();
    const nameOf = (o: THREE.Object3D) => {
      const parts: string[] = [];
      for (let x: THREE.Object3D | null = o; x && parts.length < 4; x = x.parent) {
        const u = x.userData as Record<string, unknown>;
        parts.push(x.name || (u.fixture as string) || (u.roomId as string) || (u.id as string) || x.type);
      }
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
      const desc = (x: THREE.Material) => {
        const c = (x as THREE.MeshStandardMaterial).color;
        return `${x.name || x.type.replace('Material', '')}${c ? '#' + c.getHexString() : ''}${(x as THREE.MeshStandardMaterial).vertexColors ? '+vc' : ''}${(x as THREE.MeshStandardMaterial).map ? '+map' : ''}`;
      };
      const pos = (o as THREE.Mesh).geometry.getAttribute('position');
      return `${parts.join('<')} v${pos?.count} [${(Array.isArray(m) ? m : [m]).map(desc).join(',')}]`;
    };
    const visible = (o: THREE.Object3D) => {
      for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    scene.updateMatrixWorld(true);
    let meshId = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !visible(m) || m.material === shadowOnlyMaterial) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => !x.visible || x.colorWrite === false)) return;
      const g = m.geometry;
      const pos = g.getAttribute('position');
      if (!pos) return;
      const idx = g.getIndex();
      const n = idx ? idx.count : pos.count;
      const id = `${meshId++}`;
      const name = `#${id} ${nameOf(m)}`;
      // effen materiaal (geen textuur/vertexkleuren): overlap met hetzelfde uiterlijk is onzichtbaar
      const plain = mats.length === 1 && !(mats[0] as THREE.MeshStandardMaterial).map && !(mats[0] as THREE.MeshStandardMaterial).vertexColors;
      const look = plain ? `${(mats[0] as THREE.MeshStandardMaterial).color?.getHexString()}|${(mats[0] as THREE.MeshStandardMaterial).roughness}|${mats[0].transparent}` : null;
      const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      for (let i = 0; i + 2 < n; i += 3) {
        const p = [v(i), v(i + 1), v(i + 2)];
        const nn = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
        const area = nn.length() / 2;
        if (area < 1e-4) continue;
        nn.normalize();
        const d = nn.dot(p[0]);
        const key = `${Math.round(nn.x * 50)},${Math.round(nn.y * 50)},${Math.round(nn.z * 50)},${Math.round(d / 0.004)}`;
        if (nn.y < -0.9) continue; // onderkanten (tegen de vloer) zie je niet
        const t: Tri = { p, n: nn, d, mesh: name, c: p[0].clone().add(p[1]).add(p[2]).divideScalar(3), key: id, look };
        const list = buckets.get(key) ?? [];
        list.push(t);
        buckets.set(key, list);
      }
    });
    // 2D-overlap (SAT) na de driehoeken 2 mm te krimpen, zodat gedeelde randen niet tellen
    const overlap = (a: Tri, b: Tri) => {
      if (Math.abs(a.d - b.d) > 0.001 || a.n.dot(b.n) < 0.999) return false;
      const ax = Math.abs(a.n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(a.n, ax).normalize();
      const w = new THREE.Vector3().crossVectors(a.n, u);
      const flat = (t: Tri) =>
        t.p.map((q) => {
          const s = q.clone().sub(t.c);
          s.multiplyScalar(Math.max(0, 1 - 0.002 / Math.max(1e-6, s.length())));
          s.add(t.c);
          return new THREE.Vector2(s.dot(u), s.dot(w));
        });
      const A = flat(a);
      const B = flat(b);
      for (const poly of [A, B])
        for (let i = 0; i < 3; i++) {
          const e = poly[(i + 1) % 3].clone().sub(poly[i]);
          const ax2 = new THREE.Vector2(-e.y, e.x);
          const pa = A.map((q) => q.dot(ax2));
          const pb = B.map((q) => q.dot(ax2));
          if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
        }
      return true;
    };
    const hits = new Map<string, { a: string; b: string; at: number[]; count: number; spots: number[][]; first: number[][][] }>();
    for (const list of buckets.values()) {
      if (list.length < 2 || list.length > 4000) continue;
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.c.distanceTo(b.c) > 12) continue;
          if (a.look && a.look === b.look) continue;
          if (!overlap(a, b)) continue;
          const k = [a.mesh, b.mesh].sort().join(' || ');
          const h = hits.get(k) ?? { a: a.mesh, b: b.mesh, at: a.c.toArray().map((x) => +x.toFixed(2)), count: 0, spots: [] as number[][], first: [a.p, b.p].map((t) => t.map((q) => q.toArray().map((x) => +x.toFixed(3)))) };
          h.count++;
          if (h.spots.length < 8 && h.spots.every((q) => Math.hypot(q[0] - a.c.x, q[1] - a.c.y, q[2] - a.c.z) > 0.5)) h.spots.push(a.c.toArray().map((x) => +x.toFixed(2)));
          hits.set(k, h);
        }
    }
    document.body.dataset.hdZfight = JSON.stringify([...hits.values()].sort((x, y) => y.count - x.count));
  });
  // schermpositie van een wereldpunt (voor sleeptests): body.dataset.hdProject = "x,y,z" -> hdProjected = "px,py"
  window.addEventListener('hd-debug-project', () => {
    const [x, y, z] = (document.body.dataset.hdProject ?? '0,0,0').split(',').map(Number);
    const v = new THREE.Vector3(x, y, z).project(getCamera());
    const r = gl.domElement.getBoundingClientRect();
    document.body.dataset.hdProjected = `${r.left + ((v.x + 1) / 2) * r.width},${r.top + ((1 - v.y) / 2) * r.height}`;
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
