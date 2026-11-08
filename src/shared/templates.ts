import type { Category, MaterialDef, Part, Recipe } from './recipe';

/**
 * Parametrische sjablonen: maken een recept uit een paar maten en kleuren.
 * Gebruikt door de editor op de site (en later door Claude als startpunt).
 */

export interface TemplateParams {
  width: number;
  depth: number;
  height: number;
  color: string;
  accent: string;
  [key: string]: number | string | boolean;
}

export interface TemplateDef {
  id: string;
  label: string;
  category: Category;
  defaults: TemplateParams;
  /** extra parameters met label (alleen getallen/booleans) */
  extra?: { key: string; label: string; kind: 'number' | 'boolean' | 'select'; options?: string[]; step?: number }[];
  colorLabel?: string;
  accentLabel?: string;
  build: (p: TemplateParams) => Recipe;
}

const box = (
  material: string,
  size: [number, number, number],
  position: [number, number, number],
  radius?: number,
  name?: string,
): Part => ({ shape: 'box', material, size, position, ...(radius ? { radius } : {}), ...(name ? { name } : {}) });

const cyl = (
  material: string,
  radius: number,
  height: number,
  position: [number, number, number],
  extra: Partial<Extract<Part, { shape: 'cylinder' }>> = {},
): Part => ({ shape: 'cylinder', material, radius, height, position, ...extra });

const mats = (m: Record<string, MaterialDef>) => m;

function legs(
  material: string,
  w: number,
  d: number,
  h: number,
  inset: number,
  kind: 'round' | 'square' = 'round',
  thickness = 0.035,
): Part[] {
  const xs = [-w / 2 + inset, w / 2 - inset];
  const zs = [-d / 2 + inset, d / 2 - inset];
  const out: Part[] = [];
  for (const x of xs)
    for (const z of zs)
      out.push(
        kind === 'round'
          ? cyl(material, thickness / 2, h, [x, h / 2, z], { segments: 12 })
          : box(material, [thickness, h, thickness], [x, h / 2, z]),
      );
  return out;
}

function recipe(w: number, d: number, h: number, materials: Record<string, MaterialDef>, parts: Part[], extra: Partial<Recipe> = {}): Recipe {
  return { version: 1, size: { width: w, depth: d, height: h }, materials, parts, ...extra };
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'bank',
    label: 'Bank',
    category: 'bank',
    defaults: { width: 2.2, depth: 0.95, height: 0.85, color: '#8a8580', accent: '#2b2b2b', seatHeight: 0.44, arms: true, cushions: 3 },
    extra: [
      { key: 'seatHeight', label: 'Zithoogte', kind: 'number', step: 0.01 },
      { key: 'cushions', label: 'Aantal zitkussens', kind: 'number', step: 1 },
      { key: 'arms', label: 'Armleuningen', kind: 'boolean' },
    ],
    colorLabel: 'Stof',
    accentLabel: 'Poten',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const sh = Number(p.seatHeight);
      const n = Math.max(1, Math.round(Number(p.cushions)));
      const arm = p.arms ? Math.min(0.22, w * 0.1) : 0;
      const legH = 0.1;
      const backD = Math.min(0.24, d * 0.28);
      const baseH = sh - 0.14 - legH;
      const parts: Part[] = [
        box('stof', [w, baseH, d], [0, legH + baseH / 2, 0], 0.03, 'onderstel'),
        box('stof', [w - 2 * arm, h - legH - baseH, backD], [0, legH + baseH + (h - legH - baseH) / 2, -d / 2 + backD / 2], 0.06, 'rug'),
      ];
      if (arm > 0) {
        const ah = Math.min(h - 0.12, sh + 0.2) - legH;
        parts.push(box('stof', [arm, ah, d], [-w / 2 + arm / 2, legH + ah / 2, 0], 0.05, 'arm links'));
        parts.push(box('stof', [arm, ah, d], [w / 2 - arm / 2, legH + ah / 2, 0], 0.05, 'arm rechts'));
      }
      const seatW = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + arm + seatW * (i + 0.5);
        parts.push(box('stof', [seatW - 0.01, 0.14, d - backD - 0.02], [x, sh - 0.07, backD / 2], 0.05, `zitkussen ${i + 1}`));
        parts.push(
          box('stof', [seatW - 0.03, Math.max(0.2, (h - sh) * 0.8), 0.14], [x, sh + Math.max(0.2, (h - sh) * 0.8) / 2, -d / 2 + backD + 0.05], 0.06, `rugkussen ${i + 1}`),
        );
      }
      parts.push(...legs('poot', w, d, legH, 0.06, 'round', 0.04));
      return recipe(w, d, h, mats({ stof: { color: p.color, finish: 'fabric' }, poot: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'hoekbank',
    label: 'Hoekbank',
    category: 'bank',
    defaults: { width: 2.8, depth: 2.1, height: 0.85, color: '#8a8580', accent: '#2b2b2b', seatDepth: 0.95, side: 'rechts' },
    extra: [
      { key: 'seatDepth', label: 'Zitdiepte', kind: 'number', step: 0.01 },
      { key: 'side', label: 'Hoek / chaise aan', kind: 'select', options: ['links', 'rechts'] },
    ],
    colorLabel: 'Stof',
    accentLabel: 'Poten',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const sd = Number(p.seatDepth);
      const s = p.side === 'links' ? -1 : 1;
      const legH = 0.1;
      const sh = 0.44;
      const backD = 0.22;
      const parts: Part[] = [];
      // lange deel (achter, over volle breedte)
      parts.push(box('stof', [w, sh - 0.14 - legH, sd], [0, legH + (sh - 0.14 - legH) / 2, -d / 2 + sd / 2], 0.03));
      parts.push(box('stof', [w - backD, h - sh + 0.14, backD], [-s * backD / 2, sh - 0.14 + (h - sh + 0.14) / 2, -d / 2 + backD / 2], 0.06));
      // hoekdeel (zijkant naar voren)
      const legLen = d - sd;
      parts.push(box('stof', [sd, sh - 0.14 - legH, legLen], [s * (w / 2 - sd / 2), legH + (sh - 0.14 - legH) / 2, d / 2 - legLen / 2], 0.03));
      parts.push(box('stof', [backD, h - sh + 0.14, d], [s * (w / 2 - backD / 2), sh - 0.14 + (h - sh + 0.14) / 2, 0], 0.06));
      // arm aan het open eind
      parts.push(box('stof', [0.2, sh + 0.18 - legH, sd], [-s * (w / 2 - 0.1), legH + (sh + 0.18 - legH) / 2, -d / 2 + sd / 2], 0.05));
      // zitkussens
      const seatLen = w - 0.2 - backD;
      const n = Math.max(2, Math.round(seatLen / 0.75));
      const cw = seatLen / n;
      for (let i = 0; i < n; i++) {
        const x = -s * (w / 2 - 0.2) + s * cw * (i + 0.5);
        parts.push(box('stof', [cw - 0.01, 0.14, sd - backD - 0.02], [x, sh - 0.07, -d / 2 + backD + (sd - backD) / 2], 0.05));
      }
      parts.push(box('stof', [sd - backD - 0.02, 0.14, legLen - 0.02], [s * (w / 2 - backD - (sd - backD) / 2), sh - 0.07, d / 2 - legLen / 2], 0.05));
      for (const [x, z] of [
        [-w / 2 + 0.06, -d / 2 + 0.06],
        [w / 2 - 0.06, -d / 2 + 0.06],
        [-s * (w / 2 - 0.06), -d / 2 + sd - 0.06],
        [s * (w / 2 - 0.06), d / 2 - 0.06],
        [s * (w / 2 - sd + 0.06), d / 2 - 0.06],
      ] as [number, number][])
        parts.push(cyl('poot', 0.02, legH, [x, legH / 2, z], { segments: 10 }));
      return recipe(w, d, h, mats({ stof: { color: p.color, finish: 'fabric' }, poot: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'fauteuil',
    label: 'Fauteuil',
    category: 'fauteuil',
    defaults: { width: 0.8, depth: 0.85, height: 0.85, color: '#b5793f', accent: '#2b2b2b' },
    colorLabel: 'Stof',
    accentLabel: 'Poten',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const legH = 0.14;
      const sh = 0.43;
      const parts: Part[] = [
        box('stof', [w - 0.26, 0.12, d - 0.2], [0, sh - 0.06, 0.08], 0.05),
        box('stof', [w, sh - 0.12 - legH, d], [0, legH + (sh - 0.12 - legH) / 2, 0], 0.04),
        box('stof', [w, h - legH, 0.16], [0, legH + (h - legH) / 2, -d / 2 + 0.08], 0.06),
        box('stof', [0.13, 0.28, d], [-w / 2 + 0.065, sh + 0.14 - 0.12, 0], 0.05),
        box('stof', [0.13, 0.28, d], [w / 2 - 0.065, sh + 0.14 - 0.12, 0], 0.05),
        ...legs('poot', w, d, legH, 0.07, 'round', 0.035),
      ];
      return recipe(w, d, h, mats({ stof: { color: p.color, finish: 'fabric' }, poot: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'bed',
    label: 'Bed / boxspring',
    category: 'bed',
    defaults: { width: 1.8, depth: 2.1, height: 1.2, color: '#5b5f66', accent: '#f4f2ee', mattressTop: 0.62 },
    extra: [{ key: 'mattressTop', label: 'Hoogte bovenkant matras', kind: 'number', step: 0.01 }],
    colorLabel: 'Bed en hoofdbord',
    accentLabel: 'Dekbed',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const top = Number(p.mattressTop);
      const legH = 0.08;
      const hb = 0.1;
      const baseH = top - legH - 0.22;
      const parts: Part[] = [
        box('bed', [w, h, hb], [0, h / 2, -d / 2 + hb / 2], 0.03, 'hoofdbord'),
        box('bed', [w, baseH, d - hb], [0, legH + baseH / 2, hb / 2], 0.02, 'box'),
        box('matras', [w - 0.02, 0.22, d - hb - 0.02], [0, top - 0.11, hb / 2], 0.04, 'matras'),
        box('dekbed', [w, 0.08, (d - hb) * 0.72], [0, top + 0.02, d / 2 - (d - hb) * 0.36], 0.04, 'dekbed'),
        box('dekbed', [w * 0.42, 0.12, 0.42], [-w * 0.24, top + 0.06, -d / 2 + hb + 0.26], 0.06, 'kussen'),
        box('dekbed', [w * 0.42, 0.12, 0.42], [w * 0.24, top + 0.06, -d / 2 + hb + 0.26], 0.06, 'kussen'),
        ...legs('poot', w, d - hb, legH, 0.1, 'square', 0.05).map((l) => ({ ...l, position: [l.position[0], l.position[1], l.position[2] + hb / 2] as [number, number, number] })),
      ];
      return recipe(
        w, d, h,
        mats({ bed: { color: p.color, finish: 'fabric' }, matras: { color: '#f0eee9', finish: 'fabric' }, dekbed: { color: p.accent, finish: 'fabric' }, poot: { color: '#222222', finish: 'matte' } }),
        parts,
      );
    },
  },
  {
    id: 'tafel',
    label: 'Eettafel',
    category: 'tafel',
    defaults: { width: 2.0, depth: 0.95, height: 0.76, color: '#b08a5e', accent: '#1f1f1f', round: false, legStyle: 'poten' },
    extra: [
      { key: 'round', label: 'Rond/ovaal blad', kind: 'boolean' },
      { key: 'legStyle', label: 'Onderstel', kind: 'select', options: ['poten', 'kruispoot', 'sledepoot'] },
    ],
    colorLabel: 'Blad',
    accentLabel: 'Onderstel',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const t = 0.04;
      const parts: Part[] = [
        p.round
          ? // rond/ovaal blad als platte ellipsoïde
            { shape: 'sphere', material: 'blad', radius: 0.5, scale: [w, t * 2, d], position: [0, h - t / 2, 0], name: 'blad' }
          : box('blad', [w, t, d], [0, h - t / 2, 0], 0.008, 'blad'),
      ];
      const lh = h - t;
      if (p.legStyle === 'kruispoot') {
        if (w > 1.5) {
          for (const x of [-w * 0.3, w * 0.3]) {
            parts.push(box('onderstel', [0.08, 0.05, d * 0.7], [x, 0.025, 0], 0.005));
            parts.push(box('onderstel', [0.08, lh, 0.08], [x, lh / 2, 0]));
          }
        } else {
          const len = Math.min(w, d) * 0.75;
          parts.push(box('onderstel', [len, 0.05, 0.08], [0, 0.025, 0], 0.005));
          parts.push(box('onderstel', [0.08, 0.05, len], [0, 0.025, 0], 0.005));
          parts.push(box('onderstel', [0.1, lh, 0.1], [0, lh / 2, 0], 0.005));
        }
      } else if (p.legStyle === 'sledepoot') {
        for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
          parts.push(box('onderstel', [0.06, lh, 0.06], [x, lh / 2, -d / 2 + 0.12]));
          parts.push(box('onderstel', [0.06, lh, 0.06], [x, lh / 2, d / 2 - 0.12]));
          parts.push(box('onderstel', [0.06, 0.04, d - 0.18], [x, 0.02, 0]));
          parts.push(box('onderstel', [0.06, 0.04, d - 0.18], [x, lh - 0.02, 0]));
        }
      } else {
        parts.push(...legs('onderstel', w * (p.round ? 0.75 : 1), d * (p.round ? 0.75 : 1), lh, 0.08, 'square', 0.06));
      }
      return recipe(w, d, h, mats({ blad: { color: p.color, finish: 'wood' }, onderstel: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'stoel',
    label: 'Stoel',
    category: 'stoel',
    defaults: { width: 0.5, depth: 0.58, height: 0.85, color: '#a8a39c', accent: '#1f1f1f' },
    colorLabel: 'Zitting',
    accentLabel: 'Frame',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const sh = 0.47;
      const parts: Part[] = [
        box('zitting', [w, 0.07, d - 0.06], [0, sh - 0.035, 0.03], 0.03),
        { shape: 'box', material: 'zitting', size: [w, h - sh, 0.06], position: [0, sh + (h - sh) / 2, -d / 2 + 0.06], rotation: [-8, 0, 0], radius: 0.025 },
        ...legs('frame', w - 0.04, d - 0.04, sh - 0.07, 0.03, 'round', 0.022),
      ];
      return recipe(w, d, h, mats({ zitting: { color: p.color, finish: 'velvet' }, frame: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'salontafel',
    label: 'Salontafel',
    category: 'salontafel',
    defaults: { width: 1.1, depth: 0.6, height: 0.42, color: '#3a3532', accent: '#1f1f1f', round: false },
    extra: [{ key: 'round', label: 'Rond', kind: 'boolean' }],
    colorLabel: 'Blad',
    accentLabel: 'Onderstel',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const parts: Part[] = p.round
        ? [
            { shape: 'cylinder', material: 'blad', radius: w / 2, height: 0.04, position: [0, h - 0.02, 0], segments: 48 },
            cyl('onderstel', w * 0.15, h - 0.04, [0, (h - 0.04) / 2, 0], { segments: 24 }),
          ]
        : [
            box('blad', [w, 0.04, d], [0, h - 0.02, 0], 0.006),
            box('blad', [w - 0.08, 0.03, d - 0.08], [0, 0.12, 0], 0.004),
            ...legs('onderstel', w, d, h - 0.04, 0.025, 'square', 0.035),
          ];
      return recipe(w, p.round ? w : d, h, mats({ blad: { color: p.color, finish: 'wood' }, onderstel: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'kast',
    label: 'Kast',
    category: 'kast',
    defaults: { width: 1.0, depth: 0.58, height: 2.0, color: '#f2f0ec', accent: '#8c8c8c', doors: 2, plinth: 0.08 },
    extra: [
      { key: 'doors', label: 'Aantal deuren', kind: 'number', step: 1 },
      { key: 'plinth', label: 'Plint', kind: 'number', step: 0.01 },
    ],
    colorLabel: 'Kast',
    accentLabel: 'Grepen',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const n = Math.max(1, Math.round(Number(p.doors)));
      const pl = Number(p.plinth);
      const parts: Part[] = [box('kast', [w, h - pl, d - 0.02], [0, pl + (h - pl) / 2, -0.01], 0.004), box('plint', [w - 0.04, pl, d - 0.06], [0, pl / 2, -0.02])];
      const dw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + dw * (i + 0.5);
        parts.push(box('kast', [dw - 0.006, h - pl - 0.006, 0.02], [x, pl + (h - pl) / 2, d / 2 - 0.01], 0.002));
        const hx = i % 2 === 0 ? x + dw / 2 - 0.05 : x - dw / 2 + 0.05;
        parts.push(box('greep', [0.015, Math.min(0.3, h * 0.15), 0.025], [n === 1 ? x + dw / 2 - 0.05 : hx, pl + (h - pl) * 0.5, d / 2 + 0.012], 0.004));
      }
      return recipe(w, d, h, mats({ kast: { color: p.color, finish: 'satin' }, plint: { color: '#333333', finish: 'matte' }, greep: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'ladekast',
    label: 'Ladekast / dressoir',
    category: 'opslag',
    defaults: { width: 1.6, depth: 0.45, height: 0.8, color: '#a47c55', accent: '#1f1f1f', rows: 3, cols: 2 },
    extra: [
      { key: 'rows', label: 'Rijen lades', kind: 'number', step: 1 },
      { key: 'cols', label: 'Kolommen', kind: 'number', step: 1 },
    ],
    colorLabel: 'Kast',
    accentLabel: 'Poten / grepen',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const rows = Math.max(1, Math.round(Number(p.rows)));
      const cols = Math.max(1, Math.round(Number(p.cols)));
      const legH = 0.12;
      const bodyH = h - legH;
      const parts: Part[] = [box('kast', [w, bodyH, d - 0.02], [0, legH + bodyH / 2, -0.01], 0.006)];
      const cw = w / cols;
      const rh = bodyH / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = -w / 2 + cw * (c + 0.5);
          const y = legH + rh * (r + 0.5);
          parts.push(box('kast', [cw - 0.008, rh - 0.008, 0.02], [x, y, d / 2 - 0.01], 0.003));
          parts.push(box('greep', [Math.min(0.16, cw * 0.4), 0.015, 0.02], [x, y + rh * 0.25, d / 2 + 0.01], 0.004));
        }
      parts.push(...legs('greep', w, d, legH, 0.05, 'square', 0.03));
      return recipe(w, d, h, mats({ kast: { color: p.color, finish: 'wood' }, greep: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'tv-meubel',
    label: 'TV-meubel',
    category: 'tv-meubel',
    defaults: { width: 1.8, depth: 0.4, height: 0.5, color: '#2a2a2a', accent: '#b08a5e', floating: false, tv: 65 },
    extra: [
      { key: 'floating', label: 'Zwevend (aan de wand)', kind: 'boolean' },
      { key: 'tv', label: 'Tv erop (inch, 0 = geen)', kind: 'number', step: 1 },
    ],
    colorLabel: 'Kast',
    accentLabel: 'Blad',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const floating = Boolean(p.floating);
      const legH = floating ? 0 : 0.1;
      const bodyH = h - legH;
      const parts: Part[] = [
        box('kast', [w, bodyH - 0.03, d], [0, legH + (bodyH - 0.03) / 2, 0], 0.004),
        box('blad', [w, 0.03, d], [0, h - 0.015, 0], 0.003),
      ];
      const n = Math.max(2, Math.round(w / 0.6));
      for (let i = 1; i < n; i++) parts.push(box('naad', [0.004, bodyH - 0.05, 0.004], [-w / 2 + (w / n) * i, legH + (bodyH - 0.03) / 2, d / 2 + 0.001]));
      if (!floating) parts.push(...legs('naad', w, d, legH, 0.05, 'square', 0.03));
      const inch = Number(p.tv);
      let H = h;
      if (inch > 0) {
        const diag = inch * 0.0254;
        const tw = diag * 0.8716;
        const th = diag * 0.4903;
        const standH = 0.06;
        parts.push(box('tv', [tw, th, 0.03], [0, h + standH + th / 2, -d * 0.1], 0.004, 'tv'));
        parts.push(box('scherm', [tw - 0.012, th - 0.012, 0.002], [0, h + standH + th / 2, -d * 0.1 + 0.016], 0, 'scherm'));
        parts.push(box('tv', [0.3, standH, 0.2], [0, h + standH / 2, -d * 0.1], 0.004, 'voet'));
        H = h + standH + th;
      }
      return recipe(
        Math.max(w, inch > 0 ? inch * 0.0254 * 0.8716 : 0), d, H,
        mats({ kast: { color: p.color, finish: 'satin' }, blad: { color: p.accent, finish: 'wood' }, naad: { color: '#111111', finish: 'matte' }, tv: { color: '#151515', finish: 'satin' }, scherm: { color: '#0b0d12', finish: 'gloss' } }),
        parts,
        floating ? { elevation: 0.3, mount: 'wall' } : {},
      );
    },
  },
  {
    id: 'bureau',
    label: 'Bureau',
    category: 'bureau',
    defaults: { width: 1.4, depth: 0.7, height: 0.75, color: '#efede8', accent: '#2b2b2b' },
    colorLabel: 'Blad',
    accentLabel: 'Frame',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const parts: Part[] = [box('blad', [w, 0.025, d], [0, h - 0.0125, 0], 0.004)];
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
        parts.push(box('frame', [0.05, h - 0.025, 0.05], [x, (h - 0.025) / 2, 0]));
        parts.push(box('frame', [0.06, 0.03, d - 0.08], [x, 0.015, 0]));
      }
      parts.push(box('frame', [w - 0.1, 0.06, 0.03], [0, h - 0.06, -d / 2 + 0.06]));
      return recipe(w, d, h, mats({ blad: { color: p.color, finish: 'satin' }, frame: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'boekenkast',
    label: 'Open kast / boekenkast',
    category: 'kast',
    defaults: { width: 0.8, depth: 0.35, height: 1.9, color: '#d9c6a5', accent: '#5a4a3a', shelves: 5 },
    extra: [{ key: 'shelves', label: 'Aantal vakken', kind: 'number', step: 1 }],
    colorLabel: 'Kast',
    accentLabel: 'Boeken/accent',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const n = Math.max(1, Math.round(Number(p.shelves)));
      const t = 0.022;
      const parts: Part[] = [
        box('kast', [t, h, d], [-w / 2 + t / 2, h / 2, 0]),
        box('kast', [t, h, d], [w / 2 - t / 2, h / 2, 0]),
        box('kast', [w, h, 0.006], [0, h / 2, -d / 2 + 0.003]),
      ];
      for (let i = 0; i <= n; i++) {
        const y = i === n ? h - t / 2 : 0.04 + ((h - 0.04) / n) * i + t / 2;
        parts.push(box('kast', [w - 2 * t, t, d - 0.01], [0, y, 0.005]));
      }
      for (let i = 0; i < n; i += 2) {
        const y = 0.04 + ((h - 0.04) / n) * i + t;
        const bh = Math.min(0.25, (h - 0.04) / n - 0.05);
        parts.push(box('accent', [(w - 2 * t) * 0.55, bh, d * 0.7], [-(w - 2 * t) * 0.2, y + bh / 2, 0]));
      }
      return recipe(w, d, h, mats({ kast: { color: p.color, finish: 'wood' }, accent: { color: p.accent, finish: 'matte' } }), parts);
    },
  },
  {
    id: 'vloerkleed',
    label: 'Vloerkleed',
    category: 'vloerkleed',
    defaults: { width: 2.0, depth: 3.0, height: 0.012, color: '#d8d0c4', accent: '#d8d0c4', round: false },
    extra: [{ key: 'round', label: 'Rond', kind: 'boolean' }],
    colorLabel: 'Kleur',
    build: (p) => {
      const { width: w, depth: d } = p;
      const h = Math.max(0.005, p.height);
      const part: Part = p.round
        ? { shape: 'cylinder', material: 'kleed', radius: w / 2, height: h, position: [0, h / 2, 0], segments: 64 }
        : box('kleed', [w, h, d], [0, h / 2, 0], Math.min(0.004, h / 2));
      return recipe(w, p.round ? w : d, h, mats({ kleed: { color: p.color, finish: 'fabric' } }), [part]);
    },
  },
  {
    id: 'plant',
    label: 'Plant in pot',
    category: 'plant',
    defaults: { width: 0.6, depth: 0.6, height: 1.4, color: '#4f7a45', accent: '#c9b28a' },
    colorLabel: 'Blad',
    accentLabel: 'Pot',
    build: (p) => {
      const { width: w, height: h } = p;
      const potH = Math.min(0.45, h * 0.3);
      const potR = Math.min(w / 2, 0.22);
      const parts: Part[] = [
        { shape: 'lathe', material: 'pot', points: [[0, 0], [potR * 0.75, 0], [potR, potH], [potR * 0.92, potH], [0, potH - 0.03]], position: [0, 0, 0], segments: 28 },
        cyl('stam', 0.015, h * 0.45, [0, potH + h * 0.2, 0]),
      ];
      const crownH = h - potH - h * 0.15;
      const crownY = potH + h * 0.15 + crownH / 2;
      parts.push({ shape: 'sphere', material: 'blad', radius: 0.5, scale: [w, crownH, w], position: [0, crownY, 0] });
      parts.push({ shape: 'sphere', material: 'blad2', radius: 0.5, scale: [w * 0.65, crownH * 0.6, w * 0.65], position: [w * 0.15, crownY + crownH * 0.2, -w * 0.1] });
      return recipe(w, w, h, mats({ pot: { color: p.accent, finish: 'ceramic' }, stam: { color: '#5b4632', finish: 'matte' }, blad: { color: p.color, finish: 'plant' }, blad2: { color: shade(p.color, 1.15), finish: 'plant' } }), parts);
    },
  },
  {
    id: 'vloerlamp',
    label: 'Vloerlamp',
    category: 'verlichting',
    defaults: { width: 0.45, depth: 0.45, height: 1.6, color: '#efe6d6', accent: '#1f1f1f' },
    colorLabel: 'Kap',
    accentLabel: 'Voet',
    build: (p) => {
      const { width: w, height: h } = p;
      const parts: Part[] = [
        cyl('voet', w * 0.4, 0.03, [0, 0.015, 0], { segments: 32 }),
        cyl('voet', 0.012, h - 0.3, [0, (h - 0.3) / 2, 0]),
        { shape: 'cylinder', material: 'kap', radiusTop: w * 0.35, radiusBottom: w / 2, height: 0.32, position: [0, h - 0.16, 0], segments: 32 },
      ];
      return recipe(w, w, h, mats({ voet: { color: p.accent, finish: 'metal' }, kap: { color: p.color, finish: 'light' } }), parts);
    },
  },
  {
    id: 'koelkast',
    label: 'Koelkast / apparaat',
    category: 'apparaat',
    defaults: { width: 0.91, depth: 0.72, height: 1.78, color: '#8e9196', accent: '#2a2a2a', doors: 2 },
    extra: [{ key: 'doors', label: 'Deuren naast elkaar', kind: 'number', step: 1 }],
    colorLabel: 'Kleur',
    accentLabel: 'Grepen',
    build: (p) => {
      const { width: w, depth: d, height: h } = p;
      const n = Math.max(1, Math.round(Number(p.doors)));
      const parts: Part[] = [box('body', [w, h, d - 0.04], [0, h / 2, -0.02], 0.01)];
      const dw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + dw * (i + 0.5);
        parts.push(box('body', [dw - 0.006, h - 0.02, 0.04], [x, h / 2, d / 2 - 0.02], 0.008));
        parts.push(box('greep', [0.02, h * 0.45, 0.03], [x + (i < n / 2 ? dw / 2 - 0.05 : -dw / 2 + 0.05), h * 0.55, d / 2 + 0.015], 0.008));
      }
      return recipe(w, d, h, mats({ body: { color: p.color, finish: 'metal' }, greep: { color: p.accent, finish: 'metal' } }), parts);
    },
  },
  {
    id: 'blok',
    label: 'Eenvoudig blok',
    category: 'overig',
    defaults: { width: 1, depth: 0.5, height: 0.5, color: '#c8c2b8', accent: '#c8c2b8', rounded: 0.01 },
    extra: [{ key: 'rounded', label: 'Afronding', kind: 'number', step: 0.005 }],
    colorLabel: 'Kleur',
    build: (p) =>
      recipe(p.width, p.depth, p.height, mats({ blok: { color: p.color, finish: 'matte' } }), [
        box('blok', [p.width, p.height, p.depth], [0, p.height / 2, 0], Number(p.rounded) || undefined),
      ]),
  },
];

export const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function buildFromTemplate(id: string, params: Partial<TemplateParams>): Recipe {
  const t = TEMPLATE_MAP[id];
  if (!t) throw new Error(`Onbekend sjabloon: ${id}`);
  return t.build({ ...t.defaults, ...params } as TemplateParams);
}
