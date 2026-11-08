import type { Fixture, House, Level, V2, Wall } from './house';
import type { MaterialDef, Part, Recipe } from './recipe';
import { buildFromTemplate } from './templates';

/**
 * Waalstraat 16, Nijverdal — opgemeten uit de plattegronden van de brochure (Velding.nl).
 * Schaal plattegronden ≈ 68 px/m. Binnenmaat breedte 5,53 m; diepte begane grond 11,50 m
 * (inclusief uitbouw 2022), verdieping/zolder 8,27 m.
 *
 * Oorsprong: binnenhoek achter-links van de begane grond (achtergevel uitbouw, carportzijde).
 */

// ---------- maatvoering ----------
const T_EXT = 0.28; // spouwmuur
const T_INT = 0.1; // binnenwand
const W = 5.53; // binnenbreedte
const Z_FRONT = 11.5; // binnenkant voorgevel
const Z_OLD_BACK = 3.23; // binnenkant oude achtergevel (verdieping)
const STOREY = 2.8;
const CEILING = 2.6;
const ATTIC_FLOOR = 2 * STOREY; // 5,60
const KNEE = 0.2; // hoogte dakvlak boven zoldervloer bij binnenkant gevel (aanname)
const SLOPE = 0.684; // tan(34,4°): 1,50 m-lijn ligt 1,92 m uit de gevel
const RIDGE_Z = (Z_OLD_BACK + Z_FRONT) / 2;
const ROOF_T = 0.36; // dakpakket (verticaal gemeten)

/** onderkant dakvlak (absolute hoogte) als functie van z */
export function roofUnderside(z: number): number {
  const dist = z <= RIDGE_Z ? z - Z_OLD_BACK : Z_FRONT - z;
  return ATTIC_FLOOR + KNEE + SLOPE * dist;
}

// ---------- hulpfuncties voor vaste inbouw ----------
const box = (material: string, size: [number, number, number], position: [number, number, number], radius?: number): Part => ({
  shape: 'box',
  material,
  size,
  position,
  ...(radius ? { radius } : {}),
});

function fixedRecipe(w: number, d: number, h: number, materials: Record<string, MaterialDef>, parts: Part[]): Recipe {
  return { version: 1, size: { width: w, depth: d, height: h }, materials, parts };
}

const M = {
  wit: { color: '#f5f5f2', finish: 'gloss' },
  witMat: { color: '#f2f1ee', finish: 'matte' },
  zwartSteen: { color: '#1d1d1f', finish: 'stone' },
  glas: { color: '#1b2329', finish: 'glass' },
  rvs: { color: '#b9bcbf', finish: 'metal' },
  keramiek: { color: '#fbfbfb', finish: 'ceramic' },
  tegelDonker: { color: '#55575a', finish: 'stone' },
  hout: { color: '#c39a6b', finish: 'wood' },
  houtDonker: { color: '#7a5a3c', finish: 'wood' },
  douchglas: { color: '#cfe3ea', finish: 'glass', opacity: 0.25 },
  zwart: { color: '#222222', finish: 'matte' },
  trede: { color: '#f3f3f1', finish: 'satin' },
  plint: { color: '#2a2a2a', finish: 'matte' },
} satisfies Record<string, MaterialDef>;

function stairs(width: number, run: number, rise: number, steps: number): Recipe {
  // treden stijgen richting -x (lokaal), breedte langs z
  const going = run / steps;
  const r = rise / steps;
  const parts: Part[] = [];
  for (let i = 0; i < steps; i++) {
    const x = run / 2 - going * (i + 0.5);
    const top = r * (i + 1);
    parts.push(box('trede', [going + 0.02, 0.04, width], [x, top - 0.02, 0]));
    parts.push(box('stoot', [0.02, r, width], [x + going / 2, top - r / 2, 0]));
  }
  // trapboom aan beide kanten
  const len = Math.hypot(run, rise);
  const ang = (Math.atan2(rise, run) * 180) / Math.PI;
  for (const zz of [-width / 2 + 0.02, width / 2 - 0.02])
    parts.push({ shape: 'box', material: 'trede', size: [len, 0.25, 0.04], position: [0, rise / 2 - 0.05, zz], rotation: [0, 0, -ang] });
  return fixedRecipe(run, width, rise, { trede: M.trede, stoot: M.witMat }, parts);
}

const kastenwand = fixedRecipe(1.82, 0.6, 2.25, { wit: M.wit, glas: M.glas, plint: M.plint, rvs: M.rvs }, [
  box('plint', [1.78, 0.1, 0.55], [0, 0.05, -0.02]),
  box('wit', [1.82, 2.15, 0.58], [0, 1.175, -0.01], 0.004),
  box('glas', [0.56, 0.45, 0.02], [0.3, 1.25, 0.29], 0.004),
  box('rvs', [0.58, 0.04, 0.02], [0.3, 1.5, 0.29]),
  box('wit', [0.004, 2.1, 0.005], [-0.3, 1.17, 0.3]),
  box('wit', [0.004, 2.1, 0.005], [0.0, 1.17, 0.3]),
]);

const schiereiland = fixedRecipe(1.91, 0.88, 0.94, { wit: M.wit, steen: M.zwartSteen, glas: M.glas, rvs: M.rvs }, [
  box('wit', [1.89, 0.9, 0.86], [0.01, 0.45, 0], 0.004),
  box('steen', [1.91, 0.03, 0.88], [0, 0.925, 0]),
  box('glas', [0.58, 0.004, 0.5], [-0.6, 0.943, 0]),
  box('rvs', [0.5, 0.004, 0.4], [0.35, 0.943, 0]),
  { shape: 'cylinder', material: 'rvs', radius: 0.015, height: 0.35, position: [0.35, 1.115, -0.25], segments: 12 },
]);

const koof = fixedRecipe(2.6, 1.35, 0.3, { wit: M.witMat, glas: M.glas }, [
  box('wit', [2.6, 0.3, 1.35], [0, 0.15, 0]),
  box('glas', [0.8, 0.01, 0.5], [-0.6, -0.002, 0]),
]);

const toilet = fixedRecipe(0.38, 0.55, 1.1, { k: M.keramiek, wand: M.witMat }, [
  box('wand', [0.5, 1.1, 0.15], [0, 0.55, -0.2]),
  { shape: 'sphere', material: 'k', radius: 0.5, scale: [0.36, 0.3, 0.5], position: [0, 0.36, 0.0] },
  box('k', [0.36, 0.03, 0.45], [0, 0.42, 0.02], 0.1),
]);

const fontein = fixedRecipe(0.36, 0.22, 0.15, { k: M.keramiek, rvs: M.rvs }, [
  box('k', [0.36, 0.12, 0.22], [0, 0.06, 0], 0.02),
  { shape: 'cylinder', material: 'rvs', radius: 0.01, height: 0.12, position: [0, 0.18, -0.06], segments: 10 },
]);

const ligbad = fixedRecipe(1.59, 0.77, 0.6, { tegel: M.tegelDonker, k: M.keramiek }, [
  box('tegel', [1.59, 0.58, 0.77], [0, 0.29, 0]),
  box('k', [1.45, 0.03, 0.63], [0, 0.58, 0], 0.15),
]);

const douche = fixedRecipe(0.77, 1.49, 2.0, { tegel: M.tegelDonker, glas: M.douchglas, rvs: M.rvs }, [
  box('tegel', [0.77, 0.02, 1.49], [0, 0.01, 0]),
  box('glas', [0.01, 2.0, 0.9], [0.385, 1.0, 0.25]),
  { shape: 'cylinder', material: 'rvs', radius: 0.12, height: 0.01, position: [0, 2.0, 0], segments: 24 },
]);

const wastafelmeubel = fixedRecipe(1.38, 0.4, 0.88, { hout: M.hout, k: M.keramiek, spiegel: { color: '#dfe7ea', finish: 'glass' } }, [
  box('hout', [1.38, 0.45, 0.4], [0, 0.6, 0]),
  box('k', [1.38, 0.06, 0.42], [0, 0.85, 0.01], 0.01),
  box('spiegel', [1.2, 0.8, 0.02], [0, 1.55, -0.19]),
]);

const kast = (w: number, d: number, h: number) =>
  fixedRecipe(w, d, h, { wit: M.witMat }, [box('wit', [w, h, d], [0, h / 2, 0], 0.003), box('wit', [0.004, h - 0.05, 0.004], [0, h / 2, d / 2 + 0.001])]);

const koker = (w: number, d: number, h: number) => fixedRecipe(w, d, h, { wit: M.witMat }, [box('wit', [w, h, d], [0, h / 2, 0])]);

const airco = fixedRecipe(0.8, 0.22, 0.3, { wit: M.wit }, [box('wit', [0.8, 0.3, 0.22], [0, 0.15, 0], 0.04)]);

// zwevende kasten (blijven achter): zwart met eiken blad
const zwevend = (w: number, d: number, h: number, doors: number) =>
  fixedRecipe(w, d, h, { kast: { color: '#1f1f21', finish: 'satin' }, blad: { color: '#c49a6c', finish: 'wood' }, naad: M.zwart }, [
    box('kast', [w, h - 0.03, d], [0, (h - 0.03) / 2, 0], 0.003),
    box('blad', [w, 0.03, d], [0, h - 0.015, 0]),
    ...Array.from({ length: doors - 1 }, (_, i) => box('naad', [0.004, h - 0.07, 0.004], [-w / 2 + (w / doors) * (i + 1), (h - 0.03) / 2, d / 2 + 0.001])),
  ]);

// elektrische sierhaard (glazen vuurhaard op de lowboard)
const sierhaard = fixedRecipe(1.0, 0.35, 0.42, {
  glas: { color: '#14171a', finish: 'glass', opacity: 0.55 },
  voet: M.zwart,
  vuur: { color: '#ff8a3d', finish: 'light' },
  hout: { color: '#6b5440', finish: 'wood' },
}, [
  box('voet', [1.0, 0.06, 0.35], [0, 0.03, 0]),
  box('hout', [0.6, 0.06, 0.12], [0, 0.09, 0]),
  box('vuur', [0.7, 0.08, 0.05], [0, 0.15, 0]),
  box('glas', [1.0, 0.36, 0.35], [0, 0.24, 0]),
]);

// gestucte schouw boven de sierhaard (tot het plafond)
const schouw = (h: number) => fixedRecipe(1.22, 0.4, h, { wit: M.witMat }, [box('wit', [1.22, h, 0.4], [0, h / 2, 0])]);

const amerikaanseKoelkast = buildFromTemplate('koelkast', { width: 0.91, depth: 0.72, height: 1.78, color: '#8e9196', accent: '#2a2a2a', doors: 2 });

const paal = (h: number) => fixedRecipe(0.14, 0.14, h, { hout: M.houtDonker }, [box('hout', [0.14, h, 0.14], [0, h / 2, 0])]);

const tuinberging = fixedRecipe(2.52, 1.96, 2.3, { hout: M.houtDonker, deur: { color: '#2a2a2a', finish: 'satin' } }, [
  box('hout', [2.52, 2.3, 1.96], [0, 1.15, 0]),
  box('deur', [0.85, 2.0, 0.02], [-0.6, 1.0, 0.99]),
]);

const fx = (id: string, name: string, recipe: Recipe, x: number, z: number, rotation = 0, y = 0, high = false): Fixture => ({
  id,
  name,
  recipe,
  position: [x, z],
  rotation,
  y,
  high,
});

// ---------- begane grond ----------
const ext = (id: string, a: V2, b: V2, outside: V2, openings: Wall['openings'] = [], party = false): Wall => ({
  id,
  a,
  b,
  thickness: T_EXT,
  outside,
  openings,
  party,
});
const int = (id: string, a: V2, b: V2, openings: Wall['openings'] = [], thickness = T_INT): Wall => ({ id, a, b, thickness, openings });

const bg: Level = {
  id: 'bg',
  name: 'Begane grond',
  short: 'BG',
  elevation: 0,
  storeyHeight: STOREY,
  ceilingHeight: CEILING,
  walls: [
    // gevels
    ext('bg-links', [-0.14, -0.28], [-0.14, 11.78], [-1, 0], [
      { kind: 'window', at: 2.53 + 0.28, width: 0.92, height: 1.15, sill: 1.05 }, // raam boven schiereiland
      { kind: 'frontDoor', at: 6.11 + 0.28, width: 0.9, height: 2.3 }, // voordeur onder carport
      { kind: 'window', at: 6.86 + 0.28, width: 0.6, height: 2.3, sill: 0 }, // glazen zijlicht naast voordeur
      { kind: 'window', at: 10.67 + 0.28, width: 1.66, height: 1.6, sill: 0.6 }, // hoekraam woonkamer
    ]),
    ext('bg-rechts', [5.67, -0.28], [5.67, 11.78], [1, 0], [], true),
    ext('bg-achter', [0, -0.14], [W, -0.14], [0, -1], [{ kind: 'glassDoor', at: 4.145, width: 2.69, height: 2.3 }]),
    ext('bg-voor', [0, 11.64], [W, 11.64], [0, 1], [
      { kind: 'window', at: 1.0, width: 2.0, height: 1.6, sill: 0.6 }, // hoekraam (voorzijde)
      { kind: 'window', at: 4.32, width: 1.0, height: 1.6, sill: 0.6 },
    ]),
    // berging (aangebouwd, steen)
    { id: 'berging-achter', a: [-0.28, -3.355], b: [2.76, -3.355], thickness: 0.1, outside: [0, -1], height: 2.6 },
    {
      id: 'berging-links', a: [-0.235, -3.405], b: [-0.235, -0.28], thickness: 0.1, outside: [-1, 0], height: 2.6,
      openings: [{ kind: 'door', at: -0.985 + 3.405, width: 0.85, height: 2.1 }],
    },
    {
      id: 'berging-rechts', a: [2.705, -3.405], b: [2.705, -0.28], thickness: 0.1, outside: [1, 0], height: 2.6,
      openings: [{ kind: 'door', at: -1.45 + 3.405, width: 0.84, height: 2.1 }],
    },
    // hal, meterkast, toilet
    int('hal-boven', [0, 4.89], [2.6, 4.89]),
    int('toilet-links', [1.265, 4.94], [1.265, 5.87], [], 0.09),
    int('toilet-onder', [1.31, 5.825], [2.51, 5.825], [{ kind: 'door', at: 0.45, width: 0.7, height: 2.1 }], 0.09),
    int('meterkast-deur', [0, 5.38], [1.22, 5.38], [{ kind: 'door', at: 0.6, width: 0.8, height: 2.1 }], 0.06),
    int('hal-woonkamer', [2.555, 4.84], [2.555, 7.85], [{ kind: 'glassDoor', at: 6.33 - 4.84, width: 0.92, height: 2.3 }]),
    int('hal-onder', [0, 7.795], [2.6, 7.795], [], 0.11),
  ],
  rooms: [
    { id: 'keuken', name: 'Keuken & eetkamer', polygon: [[0, 0], [W, 0], [W, 4.84], [0, 4.84]], floor: 'visgraat', label: [3.6, 2.4] },
    {
      id: 'woonkamer', name: 'Woonkamer', floor: 'visgraat', label: [3.6, 8.6],
      polygon: [[2.6, 4.84], [W, 4.84], [W, Z_FRONT], [0, Z_FRONT], [0, 7.85], [2.6, 7.85]],
    },
    { id: 'hal', name: 'Hal', floor: 'visgraat', label: [0.7, 6.2], polygon: [[0, 5.41], [1.22, 5.41], [1.22, 5.87], [2.51, 5.87], [2.51, 7.74], [0, 7.74]] },
    { id: 'toilet', name: 'Toilet', floor: 'tegels-licht', label: [1.9, 5.35], polygon: [[1.31, 4.94], [2.51, 4.94], [2.51, 5.78], [1.31, 5.78]] },
    { id: 'meterkast', name: 'Mk', floor: 'beton', polygon: [[0, 4.94], [1.22, 4.94], [1.22, 5.35], [0, 5.35]] },
    { id: 'berging', name: 'Berging', floor: 'beton', label: [1.2, -1.8], polygon: [[-0.19, -3.31], [2.66, -3.31], [2.66, -0.28], [-0.19, -0.28]] },
  ],
  fixtures: [
    fx('kastenwand', 'Kastenwand met combi-oven', kastenwand, 0.91, 0.3),
    fx('schiereiland', 'Schiereiland met inductie en spoelbak', schiereiland, 0.955, 2.56),
    fx('koof', 'Verlaagd plafond met afzuiging', koof, 1.3, 2.55, 0, CEILING - 0.3, true),
    fx('airco-bg', 'Airco', airco, 0.11, 4.45, 90, 2.15, true),
    // blijven achter / overgenomen (zie lijst van zaken)
    fx('koelkast', 'Amerikaanse koelkast', amerikaanseKoelkast, 0.485, 4.48, 180),
    fx('lowboard', 'Zwevende lowboard', zwevend(3.9, 0.4, 0.4, 6), W - 0.2, 9.35, -90, 0.25),
    fx('sierhaard', 'Elektrische sierhaard', sierhaard, W - 0.2, 9.18, -90, 0.65),
    fx('schouw', 'Schouw', schouw(CEILING - 1.07), W - 0.2, 9.18, -90, 1.07),
    fx('tv-meubel', 'Zwevend tv-meubel', zwevend(1.8, 0.4, 0.42, 3), 2.92, Z_FRONT - 0.2, 180, 0.22),
    fx('toilet-bg', 'Toilet', toilet, 2.23, 5.22, -90),
    fx('fontein', 'Fontein', fontein, 1.42, 5.5, 90, 0.8),
    fx('koker-bg', 'Leidingkoker', koker(0.43, 0.95, STOREY), 2.275, 7.265),
    fx('trap-bg', 'Trap', stairs(0.85, 1.95, STOREY, 13), 0.975, 7.32),
  ],
};

// ---------- eerste verdieping ----------
const v1: Level = {
  id: 'v1',
  name: 'Eerste verdieping',
  short: '1e',
  elevation: STOREY,
  storeyHeight: STOREY,
  ceilingHeight: CEILING,
  walls: [
    ext('v1-links', [-0.14, Z_OLD_BACK - T_EXT], [-0.14, 11.78], [-1, 0], [
      { kind: 'window', at: 6.085 - (Z_OLD_BACK - T_EXT), width: 0.79, height: 1.2, sill: 1.0 },
    ]),
    ext('v1-rechts', [5.67, Z_OLD_BACK - T_EXT], [5.67, 11.78], [1, 0], [], true),
    ext('v1-achter', [0, Z_OLD_BACK - 0.14], [W, Z_OLD_BACK - 0.14], [0, -1], [
      { kind: 'window', at: 2.115, width: 0.63, height: 0.9, sill: 1.2 },
      { kind: 'window', at: 3.025, width: 0.85, height: 1.25, sill: 0.85 },
      { kind: 'window', at: 4.605, width: 1.41, height: 1.25, sill: 0.85 },
    ]),
    ext('v1-voor', [0, 11.64], [W, 11.64], [0, 1], [
      { kind: 'window', at: 1.745, width: 1.31, height: 1.3, sill: 0.85 },
      { kind: 'window', at: 3.645, width: 1.31, height: 1.3, sill: 0.85 },
    ]),
    int('bad-rechts', [2.525, Z_OLD_BACK], [2.525, 5.61], [], 0.13),
    int('bad-onder', [0, 5.575], [2.46, 5.575], [{ kind: 'door', at: 1.715, width: 0.83, height: 2.1 }], 0.08),
    int('slk1-schuin', [2.59, 5.61], [3.52, 6.43], [{ kind: 'door', at: 0.62, width: 0.8, height: 2.1 }]),
    int('slk1-inloop', [3.61, 6.93], [W, 6.93], [{ kind: 'passage', at: 0.96, width: 1.7, height: 2.2 }], 0.05),
    int('inloop-links', [3.565, 6.43], [3.565, 8.88], [], 0.09),
    int('slk3-boven', [2.59, 8.83], [W, 8.83], [{ kind: 'door', at: 3.025 - 2.59, width: 0.81, height: 2.1 }]),
    int('slk2-rechts', [2.545, 7.73], [2.545, Z_FRONT], [{ kind: 'door', at: 8.3 - 7.73, width: 0.84, height: 2.1 }], 0.09),
    int('slk2-boven', [0, 7.77], [2.14, 7.77], [], 0.12),
    int('trap-wand', [2.085, 6.75], [2.085, 7.31], [], 0.11),
    int('douche-wand', [0, 4.78], [0.85, 4.78], [], 0.12),
  ],
  rooms: [
    { id: 'badkamer', name: 'Badkamer', floor: 'tegels-donker', label: [1.2, 4.6], polygon: [[0, Z_OLD_BACK], [2.46, Z_OLD_BACK], [2.46, 5.54], [0, 5.54]] },
    {
      id: 'slaapkamer-1', name: 'Slaapkamer 1', floor: 'laminaat', label: [4.2, 4.8],
      polygon: [[2.59, Z_OLD_BACK], [W, Z_OLD_BACK], [W, 6.91], [3.61, 6.91], [3.61, 6.45], [2.59, 5.61]],
    },
    { id: 'inloopkast', name: 'Inloopkast', floor: 'laminaat', label: [4.55, 7.85], polygon: [[3.61, 6.96], [W, 6.96], [W, 8.78], [3.61, 8.78]] },
    { id: 'slaapkamer-2', name: 'Slaapkamer 2', floor: 'laminaat', label: [1.25, 9.7], polygon: [[0, 7.83], [2.5, 7.83], [2.5, Z_FRONT], [0, Z_FRONT]] },
    { id: 'slaapkamer-3', name: 'Slaapkamer 3', floor: 'laminaat', label: [4.05, 10.2], polygon: [[2.59, 8.88], [W, 8.88], [W, Z_FRONT], [2.59, Z_FRONT]] },
    {
      id: 'overloop-1', name: 'Overloop', floor: 'laminaat', label: [2.9, 7.6],
      polygon: [[0, 5.61], [2.59, 5.61], [3.52, 6.43], [3.52, 8.78], [2.59, 8.78], [2.59, 7.83], [2.14, 7.83], [2.14, 6.75], [0, 6.75]],
    },
  ],
  fixtures: [
    fx('ligbad', 'Ligbad', ligbad, 1.665, 3.645),
    fx('douche', 'Inloopdouche', douche, 0.385, 3.98),
    fx('toilet-v1', 'Toilet', toilet, 0.28, 5.18, 90),
    fx('wastafel', 'Dubbel wastafelmeubel', wastafelmeubel, 2.265, 4.7, -90),
    fx('kast-k', 'Inbouwkast', kast(1.15, 0.5, 2.0), 4.955, 11.25, 180),
    fx('koker-v1', 'Leidingkoker', koker(0.42, 0.52, STOREY), 2.35, 7.57),
    fx('trap-v1', 'Trap naar zolder', stairs(0.9, 2.0, STOREY, 13), 1.02, 7.24),
  ],
};

// ---------- zolder ----------
const attTop = (extra: number) => (z: number) => roofUnderside(z) - ATTIC_FLOOR + extra;

const zolder: Level = {
  id: 'zolder',
  name: 'Zolder',
  short: 'Zolder',
  elevation: ATTIC_FLOOR,
  storeyHeight: 3.4,
  ceilingHeight: roofUnderside(RIDGE_Z) - ATTIC_FLOOR,
  walls: [
    { id: 'z-links', a: [-0.14, Z_OLD_BACK - T_EXT], b: [-0.14, 11.78], thickness: T_EXT, outside: [-1, 0], topByZ: attTop(ROOF_T) },
    { id: 'z-rechts', a: [5.67, Z_OLD_BACK - T_EXT], b: [5.67, 11.78], thickness: T_EXT, outside: [1, 0], party: true, topByZ: attTop(ROOF_T) },
    {
      id: 'z-overloop', a: [2.515, Z_OLD_BACK], b: [2.515, 6.62], thickness: 0.09, topByZ: attTop(0),
      openings: [{ kind: 'door', at: 6.235 - Z_OLD_BACK, width: 0.77, height: 2.0 }],
    },
  ],
  rooms: [
    { id: 'overloop-z', name: 'Overloop', floor: 'laminaat', label: [1.2, 5.6], polygon: [[0, Z_OLD_BACK], [2.47, Z_OLD_BACK], [2.47, 6.62], [0, 6.62]] },
    {
      id: 'zolderkamer', name: 'Zolderkamer', floor: 'laminaat', label: [3.9, 8.3],
      polygon: [[2.56, Z_OLD_BACK], [W, Z_OLD_BACK], [W, Z_FRONT], [0, Z_FRONT], [0, 7.73], [2.56, 7.73]],
    },
  ],
  fixtures: [fx('koker-z', 'Leidingkoker / cv', koker(0.53, 1.11, 2.3), 2.295, 7.175)],
};

// ---------- huis ----------
export const waalstraat16: House = {
  name: 'Waalstraat 16, Nijverdal',
  north: [-1, 0],
  levels: [bg, v1, zolder],
  roofs: [
    {
      kind: 'gable',
      x0: -0.45,
      x1: 5.81,
      zBack: Z_OLD_BACK - T_EXT - 0.35,
      zFront: 11.78 + 0.35,
      ridgeZ: RIDGE_Z,
      underside: roofUnderside,
      thickness: ROOF_T,
      skylights: [
        { x0: 3.71, x1: 4.39, z0: 5.1, z1: 6.1 },
        { x0: 1.0, x1: 1.67, z0: 9.0, z1: 9.5 },
      ],
    },
    { kind: 'flat', x0: -0.28, x1: 5.81, z0: -0.28, z1: Z_OLD_BACK - T_EXT, y: STOREY, thickness: 0.25, color: '#3b3b3d' }, // uitbouw
    { kind: 'flat', x0: -0.33, x1: 2.81, z0: -3.45, z1: -0.28, y: 2.6, thickness: 0.2, color: '#3b3b3d' }, // berging
    { kind: 'flat', x0: -4.25, x1: -0.28, z0: 3.4, z1: 9.3, y: 2.45, thickness: 0.2, color: '#6b5440' }, // carport
    { kind: 'flat', x0: 0.34, x1: 5.81, z0: -13.4, z1: -10.1, y: 2.5, thickness: 0.2, color: '#6b5440' }, // overkapping
    { kind: 'flat', x0: 2.65, x1: 5.81, z0: -10.1, z1: -7.03, y: 2.5, thickness: 0.2, color: '#6b5440' },
  ],
  neighbors: [
    {
      // Waalstraat 14: de andere helft van de twee-onder-een-kap (gespiegeld, zonder uitbouw)
      name: 'Waalstraat 14',
      x0: 5.81,
      x1: 11.62,
      z0: Z_OLD_BACK - T_EXT,
      z1: 11.78,
      height: ATTIC_FLOOR,
      roof: {
        kind: 'gable',
        x0: 5.81,
        x1: 12.07,
        zBack: Z_OLD_BACK - T_EXT - 0.35,
        zFront: 11.78 + 0.35,
        ridgeZ: RIDGE_Z,
        underside: roofUnderside,
        thickness: ROOF_T,
      },
    },
  ],
  outdoor: {
    bounds: { x0: -12, x1: 14, z0: -20, z1: 24 },
    areas: [
      { id: 'tuin', name: 'Tuin', floor: 'tuintegels', label: [1.5, -6], polygon: [[-4.4, -13.4], [5.81, -13.4], [5.81, -0.28], [-4.4, -0.28]] },
      { id: 'gras', name: 'Gras', floor: 'gras', polygon: [[-4.4, -13.4], [0.3, -13.4], [0.3, -9.2], [-4.4, -9.2]] },
      { id: 'pad', name: 'Achterom', floor: 'tuintegels', polygon: [[-4.4, -0.28], [-0.28, -0.28], [-0.28, 3.46], [-4.4, 3.46]] },
      { id: 'oprit', name: 'Carport & oprit', floor: 'asfalt', label: [-2.3, 6.3], polygon: [[-4.4, 3.46], [-0.28, 3.46], [-0.28, 16.8], [-4.4, 16.8]] },
      { id: 'voortuin', name: 'Voortuin', floor: 'grind', label: [2.7, 14.3], polygon: [[-0.28, 11.78], [5.81, 11.78], [5.81, 16.8], [-0.28, 16.8]] },
      { id: 'straat', name: 'Waalstraat', floor: 'klinkers', label: [0.7, 20], polygon: [[-12, 16.8], [14, 16.8], [14, 24], [-12, 24]] },
    ],
    fences: [
      { a: [-4.4, -13.4], b: [5.81, -13.4], height: 1.8 },
      { a: [-4.4, -13.4], b: [-4.4, 3.4], height: 1.8 },
      { a: [5.81, -13.4], b: [5.81, -3.45], height: 1.8 },
      { a: [-4.4, 3.4], b: [-1.3, 3.4], height: 1.8 },
    ],
    fixtures: [
      fx('carport-p1', 'Carportpaal', paal(2.45), -4.1, 3.55),
      fx('carport-p2', 'Carportpaal', paal(2.45), -4.1, 6.4),
      fx('carport-p3', 'Carportpaal', paal(2.45), -4.1, 9.2),
      fx('overkapping-p1', 'Paal overkapping', paal(2.5), 0.41, -13.33),
      fx('overkapping-p2', 'Paal overkapping', paal(2.5), 0.41, -10.17),
      fx('overkapping-p3', 'Paal overkapping', paal(2.5), 2.72, -10.17),
      fx('overkapping-p4', 'Paal overkapping', paal(2.5), 3.36, -7.1),
      fx('overkapping-p5', 'Paal overkapping', paal(2.5), 5.74, -7.1),
      fx('overkapping-p6', 'Paal overkapping', paal(2.5), 5.74, -10.17),
      fx('tuinberging', 'Houten berging', tuinberging, 4.55, -12.42),
    ],
  },
  assumptions: [
    'Plafondhoogte 2,60 m, verdiepingshoogte 2,80 m (standaardmaat).',
    'Binnendeuren 83 × 211,5 cm, voordeur 90 × 230 cm.',
    'Dakhelling ca. 34° afgeleid uit de 1,50 m-lijn op de zolderplattegrond; nok ± 3,0 m boven zoldervloer.',
    'Vensterbanken en raamhoogtes geschat op basis van de foto’s.',
    'Ligging overkapping en tuinberging in de tuin is indicatief.',
    'Buurpand (nr. 14) is als gespiegelde massa zonder uitbouw toegevoegd, alleen voor schaduw en context.',
    'Losse meubels van de verkopers zijn weggelaten. Zwevend tv-meubel, lowboard met sierhaard en de Amerikaanse koelkast blijven en staan vast in het huis (maten deels geschat uit foto’s).',
  ],
};
