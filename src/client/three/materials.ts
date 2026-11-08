import * as THREE from 'three';
import type { MaterialDef } from '../../shared/recipe';
import type { FloorMaterial } from '../../shared/house';

/** Procedurele texturen (canvas), zodat we geen afbeeldingen hoeven te laden. */

const texCache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** deterministische pseudo-random */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function plankFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: [number, number, number], r: () => number, alongX: boolean) {
  const v = 0.86 + r() * 0.2;
  ctx.fillStyle = `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`;
  ctx.fillRect(x, y, w, h);
  // nerf
  ctx.globalAlpha = 0.08;
  const lines = 6;
  for (let i = 0; i < lines; i++) {
    ctx.fillStyle = r() > 0.5 ? '#000' : '#fff';
    if (alongX) ctx.fillRect(x, y + r() * h, w, 1 + r() * 1.5);
    else ctx.fillRect(x + r() * w, y, 1 + r() * 1.5, h);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(60,40,20,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/**
 * Visgraat (planken 50 × 10 cm), naadloze textuur van 1 × 1 m.
 * Rooster: v1 = (W, W), v2 = (nW, -nW); per roostercel één liggende en één staande plank.
 */
function herringbone(): THREE.Texture {
  return canvasTexture('visgraat', 1024, (ctx, s) => {
    const n = 5;
    const Wd = s / (2 * n);
    const L = n * Wd;
    const base: [number, number, number] = [218, 192, 156];
    const tones: number[] = [];
    const r = rng(7);
    for (let k = 0; k < 20; k++) tones.push(r());
    const tone = (i: number, j: number) => {
      const j0 = ((j % 2) + 2) % 2;
      const i0 = (((i + 5 * (j0 - j)) % 10) + 10) % 10;
      return tones[i0 * 2 + j0];
    };
    ctx.fillStyle = '#b89a72';
    ctx.fillRect(0, 0, s, s);
    for (let i = -30; i < 30; i++)
      for (let j = -12; j < 12; j++) {
        const ox = i * Wd + j * L;
        const oy = i * Wd - j * L;
        if (ox > s + L || ox < -2 * L || oy > s + L || oy < -2 * L) continue;
        const t = tone(i, j);
        const rr = rng(Math.floor(t * 1e6));
        const b: [number, number, number] = [base[0] * (0.9 + t * 0.16), base[1] * (0.9 + t * 0.16), base[2] * (0.9 + t * 0.16)];
        plankFill(ctx, ox, oy, L, Wd, b, rr, true);
        const t2 = tones[(Math.floor(t * 97) + 3) % 20];
        const b2: [number, number, number] = [base[0] * (0.9 + t2 * 0.16), base[1] * (0.9 + t2 * 0.16), base[2] * (0.9 + t2 * 0.16)];
        plankFill(ctx, ox + L, oy + Wd - L, Wd, L, b2, rr, false);
      }
  });
}

function planks(key: string, base: [number, number, number], plankW: number, plankL: number): THREE.Texture {
  return canvasTexture(key, 1024, (ctx, s) => {
    const r = rng(11);
    const pw = s * plankW;
    const pl = s * plankL;
    for (let y = 0; y < s; y += pw) {
      const off = r() * pl;
      for (let x = -off; x < s; x += pl) plankFill(ctx, x, y, pl, pw, base, r, true);
    }
  });
}

function tiles(key: string, base: string, grout: string, n: number, jitter = 0.04, offsetRows = false): THREE.Texture {
  return canvasTexture(key, 512, (ctx, s) => {
    const r = rng(3);
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, s, s);
    const t = s / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const c = new THREE.Color(base);
        const v = 1 + (r() - 0.5) * jitter * 2;
        c.multiplyScalar(v);
        ctx.fillStyle = `#${c.getHexString()}`;
        const off = offsetRows && j % 2 ? t / 2 : 0;
        ctx.fillRect(i * t + 2 + off, j * t + 2, t - 4, t - 4);
        if (off) ctx.fillRect(i * t + 2 + off - s, j * t + 2, t - 4, t - 4);
      }
  });
}

function noise(key: string, base: string, amount: number, size = 256, speck = 1): THREE.Texture {
  return canvasTexture(key, size, (ctx, s) => {
    const r = rng(5);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const c = new THREE.Color(base);
    for (let i = 0; i < s * s * 0.25; i++) {
      const v = 1 + (r() - 0.5) * amount * 2;
      const cc = c.clone().multiplyScalar(v);
      ctx.fillStyle = `#${cc.getHexString()}`;
      ctx.fillRect(r() * s, r() * s, speck, speck);
    }
  });
}

/** grijswaardenkorrel voor stof/hout op meubels (vermenigvuldigd met kleur) */
function fabricMap(): THREE.Texture {
  return canvasTexture('fabric', 256, (ctx, s) => {
    const r = rng(9);
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`;
      ctx.fillRect(x, 0, 1, s);
    }
  });
}

function woodMap(): THREE.Texture {
  return canvasTexture('wood', 512, (ctx, s) => {
    const r = rng(21);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const y = r() * s;
      ctx.strokeStyle = `rgba(80,50,20,${0.05 + r() * 0.1})`;
      ctx.lineWidth = 1 + r() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) ctx.lineTo(x, y + Math.sin(x / 60 + i) * 4 * r());
      ctx.stroke();
    }
  });
}

// ---------- vloeren ----------
const floorCache = new Map<FloorMaterial, THREE.MeshStandardMaterial>();

/** tegelgrootte in meters per textuurherhaling */
const FLOOR_DEFS: Record<FloorMaterial, () => { map: THREE.Texture; size: number; roughness: number; color?: string }> = {
  visgraat: () => ({ map: herringbone(), size: 1.0, roughness: 0.55 }),
  laminaat: () => ({ map: planks('laminaat', [150, 118, 88], 0.19, 1.28), size: 1.0, roughness: 0.6 }),
  'tegels-donker': () => ({ map: tiles('tegels-donker', '#5d5f62', '#47494b', 2), size: 1.2, roughness: 0.45 }),
  'tegels-licht': () => ({ map: tiles('tegels-licht', '#d9d7d2', '#b9b6b0', 3), size: 0.9, roughness: 0.4 }),
  beton: () => ({ map: noise('beton', '#a7a49e', 0.06), size: 2, roughness: 0.9 }),
  tuintegels: () => ({ map: tiles('tuintegels', '#a29d95', '#8a857e', 4, 0.06), size: 2.4, roughness: 0.95 }),
  gras: () => ({ map: noise('gras', '#6f9a4f', 0.18, 256, 2), size: 2, roughness: 1 }),
  asfalt: () => ({ map: noise('asfalt', '#4d4f52', 0.12), size: 2, roughness: 0.95 }),
  klinkers: () => ({ map: tiles('klinkers', '#9b6a55', '#7c5546', 10, 0.12, true), size: 2.1, roughness: 0.95 }),
  grind: () => ({ map: noise('grind', '#9c978f', 0.25, 256, 2), size: 1.5, roughness: 1 }),
};

export function floorMaterial(kind: FloorMaterial): THREE.MeshStandardMaterial {
  const hit = floorCache.get(kind);
  if (hit) return hit;
  const def = FLOOR_DEFS[kind]();
  const map = def.map.clone();
  map.needsUpdate = true;
  map.repeat.set(1 / def.size, 1 / def.size);
  const m = new THREE.MeshStandardMaterial({ map, roughness: def.roughness, metalness: 0 });
  floorCache.set(kind, m);
  return m;
}

// ---------- meubels ----------
const matCache = new Map<string, THREE.Material>();

export function recipeMaterial(def: MaterialDef | undefined): THREE.Material {
  const d: MaterialDef = def ?? { color: '#cccccc', finish: 'matte' };
  const key = `${d.color}|${d.finish}|${d.opacity ?? 1}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const color = new THREE.Color(d.color);
  let m: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  switch (d.finish) {
    case 'gloss':
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.2 });
      break;
    case 'satin':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.85 });
      break;
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity: d.opacity ?? 0.45, depthWrite: false });
      break;
    case 'fabric':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, map: fabricMap() });
      break;
    case 'velvet':
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: color.clone().offsetHSL(0, 0, 0.15) });
      break;
    case 'leather':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
      break;
    case 'wood':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.65, map: woodMap() });
      break;
    case 'stone':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      break;
    case 'plastic':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      break;
    case 'ceramic':
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, clearcoat: 0.8 });
      break;
    case 'plant':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
      break;
    case 'light':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.35 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  }
  if (d.opacity !== undefined && d.opacity < 1 && d.finish !== 'glass') {
    m.transparent = true;
    m.opacity = d.opacity;
  }
  matCache.set(key, m);
  return m;
}

// ---------- huis ----------
export const HOUSE_COLORS = {
  paint: new THREE.Color('#efebe4'),
  brick: new THREE.Color('#9a5a42'),
  party: new THREE.Color('#d9d4cb'),
  cap: new THREE.Color('#4b4744'),
  frame: '#2e3236',
  roof: '#4a4442',
  fence: '#7a6048',
};

export const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
export const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#a9c6d3', roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false });
export const frameMaterial = new THREE.MeshStandardMaterial({ color: HOUSE_COLORS.frame, roughness: 0.5 });
export const doorMaterial = new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.45 });
export const roofMaterial = (() => {
  const m = new THREE.MeshStandardMaterial({ color: HOUSE_COLORS.roof, roughness: 0.85 });
  if (typeof document !== 'undefined') {
    const t = canvasTexture('dakpan', 256, (ctx, s) => {
      ctx.fillStyle = '#8a8580';
      ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += s / 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y, s, 3);
        for (let x = (y / (s / 8)) % 2 ? s / 12 : 0; x < s; x += s / 6) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(x, y, 2, s / 8);
        }
      }
    });
    const map = t.clone();
    map.needsUpdate = true;
    map.repeat.set(1 / 1.5, 1 / 1.5);
    m.map = map;
    m.color.set('#6a625e');
  }
  return m;
})();
export const slabEdgeMaterial = new THREE.MeshStandardMaterial({ color: '#d8d3ca', roughness: 0.9 });
export const fenceMaterial = new THREE.MeshStandardMaterial({ color: HOUSE_COLORS.fence, roughness: 0.9 });
export const groundMaterial = new THREE.MeshStandardMaterial({ color: '#86a86a', roughness: 1 });
