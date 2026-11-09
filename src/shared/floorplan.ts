import type { House, Level, Opening, V2, Wall } from './house';
import type { Item, Placement } from './recipe';
import { polygonArea, roomBox, roomCenter } from './analysis';
import { corners } from './placement';

/**
 * Plattegrond als SVG (eenheid in de tekening: centimeters), voor afdrukken/PDF en PNG.
 * Bovenaanzicht met de straat onderaan: x naar rechts, z naar beneden.
 */

export interface FloorplanOptions {
  furniture?: boolean;
  /** maatvoering: buitenmaten en kamermaten */
  dims?: boolean;
  /** schaal 1:N op A4 staand (automatisch als leeg) */
  scale?: number;
  date?: string;
}

/** A4 staand, bruikbare ruimte in mm (10 mm marge, ruimte voor de titel) */
const PAGE_W = 190;
const PAGE_H = 262;
const SCALES = [50, 75, 100, 200];

const FLOOR_TINT: Record<string, string> = {
  visgraat: '#f3ebdd',
  laminaat: '#f3ece0',
  'tegels-donker': '#e7e8e9',
  'tegels-licht': '#f1f1ef',
  beton: '#eeedea',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v: number) => Math.round(v * 10) / 10;
const P = (p: V2) => `${r1(p[0] * 100)},${r1(p[1] * 100)}`;
const poly = (pts: V2[], attrs: string) => `<polygon points="${pts.map(P).join(' ')}" ${attrs}/>`;
const fmtM = (m: number) => m.toFixed(2).replace('.', ',');

function frame(w: Wall) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
  const d: V2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const n: V2 = [-d[1], d[0]];
  const at = (u: number, s: number): V2 => [w.a[0] + d[0] * u + n[0] * s, w.a[1] + d[1] * u + n[1] * s];
  return { len, d, n, at };
}

function wallSvg(w: Wall): string {
  const f = frame(w);
  const t = w.thickness / 2;
  const ops = (w.openings ?? [])
    .map((o) => ({ o, u0: Math.max(0, o.at - o.width / 2), u1: Math.min(f.len, o.at + o.width / 2) }))
    .sort((a, b) => a.u0 - b.u0);
  const fill = w.party ? '#6b6b6b' : w.outside ? '#2b2b2b' : '#4a4a4a';
  const out: string[] = [];
  let u = 0;
  for (const { u0, u1 } of ops) {
    if (u0 > u + 0.001) out.push(poly([f.at(u, -t), f.at(u0, -t), f.at(u0, t), f.at(u, t)], `fill="${fill}"`));
    u = Math.max(u, u1);
  }
  if (u < f.len - 0.001) out.push(poly([f.at(u, -t), f.at(f.len, -t), f.at(f.len, t), f.at(u, t)], `fill="${fill}"`));
  for (const { o, u0, u1 } of ops) out.push(openingSvg(w, o, u0, u1));
  return out.join('');
}

function openingSvg(w: Wall, o: Opening, u0: number, u1: number): string {
  const f = frame(w);
  const t = w.thickness / 2;
  const line = (a: V2, b: V2, extra = '') => `<line x1="${r1(a[0] * 100)}" y1="${r1(a[1] * 100)}" x2="${r1(b[0] * 100)}" y2="${r1(b[1] * 100)}" ${extra}/>`;
  if (o.kind === 'window' || o.kind === 'glassDoor') {
    // kozijn: dunne rechthoek met glaslijn in het midden
    const s = [
      poly([f.at(u0, -t), f.at(u1, -t), f.at(u1, t), f.at(u0, t)], 'fill="#ffffff" stroke="#2b2b2b" stroke-width="1.2"'),
      line(f.at(u0, 0), f.at(u1, 0), 'stroke="#2b2b2b" stroke-width="1"'),
    ];
    if (o.kind === 'glassDoor') s.push(line(f.at(u0, -t * 0.4), f.at((u0 + u1) / 2, -t * 0.4), 'stroke="#2b2b2b" stroke-width="1"'));
    return s.join('');
  }
  if (o.kind === 'passage') return '';
  // deur: blad haaks op de muur en een kwartcirkel; draait naar de binnenkant (voordeur) of +n (zoals in 3D)
  const out = w.outside ? (f.n[0] * w.outside[0] + f.n[1] * w.outside[1] > 0 ? -1 : 1) : 1;
  const side = o.kind === 'frontDoor' ? out : 1;
  const width = u1 - u0;
  const hingeU = u0;
  const hinge = f.at(hingeU, side * t);
  const leafEnd = f.at(hingeU, side * (t + width));
  const closed = f.at(u1, side * t);
  // boog om het scharnier: draairichting volgt uit het kruisproduct (SVG: y omlaag, positief = met de klok mee)
  const A: V2 = [leafEnd[0] - hinge[0], leafEnd[1] - hinge[1]];
  const B: V2 = [closed[0] - hinge[0], closed[1] - hinge[1]];
  const sw = A[0] * B[1] - A[1] * B[0] > 0 ? 1 : 0;
  return [
    line(hinge, leafEnd, 'stroke="#2b2b2b" stroke-width="1.6"'),
    `<path d="M ${P(leafEnd)} A ${r1(width * 100)} ${r1(width * 100)} 0 0 ${sw} ${P(closed)}" fill="none" stroke="#2b2b2b" stroke-width="0.8" stroke-dasharray="4 3"/>`,
  ].join('');
}

/** maatlijn met eindstreepjes en tekst (afstanden in m) */
function dimLine(a: V2, b: V2, offset: V2, label: string): string {
  const A: V2 = [a[0] + offset[0], a[1] + offset[1]];
  const B: V2 = [b[0] + offset[0], b[1] + offset[1]];
  const mid: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const vertical = Math.abs(B[1] - A[1]) > Math.abs(B[0] - A[0]);
  const tick = (p: V2) => `<line x1="${r1(p[0] * 100 - 6)}" y1="${r1(p[1] * 100 + 6)}" x2="${r1(p[0] * 100 + 6)}" y2="${r1(p[1] * 100 - 6)}" stroke="#333" stroke-width="1.2"/>`;
  const ext = (p: V2, q: V2) => `<line x1="${r1(p[0] * 100)}" y1="${r1(p[1] * 100)}" x2="${r1(q[0] * 100)}" y2="${r1(q[1] * 100)}" stroke="#999" stroke-width="0.6"/>`;
  const text = vertical
    ? `<text x="${r1(mid[0] * 100 - 8)}" y="${r1(mid[1] * 100)}" transform="rotate(-90 ${r1(mid[0] * 100 - 8)} ${r1(mid[1] * 100)})" text-anchor="middle" class="dim">${label}</text>`
    : `<text x="${r1(mid[0] * 100)}" y="${r1(mid[1] * 100 - 8)}" text-anchor="middle" class="dim">${label}</text>`;
  return `${ext(a, A)}${ext(b, B)}<line x1="${r1(A[0] * 100)}" y1="${r1(A[1] * 100)}" x2="${r1(B[0] * 100)}" y2="${r1(B[1] * 100)}" stroke="#333" stroke-width="0.8"/>${tick(A)}${tick(B)}${text}`;
}

function levelBounds(level: Level) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const w of level.walls) {
    const f = frame(w);
    const t = w.thickness / 2;
    for (const p of [f.at(0, -t), f.at(0, t), f.at(f.len, -t), f.at(f.len, t)]) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]);
      z1 = Math.max(z1, p[1]);
    }
  }
  return { x0, x1, z0, z1 };
}

export function floorplanSvg(house: House, levelIndex: number, placements: Placement[], items: Item[], opts: FloorplanOptions = {}): string {
  const level = house.levels[levelIndex];
  const furniture = opts.furniture !== false;
  const dims = opts.dims !== false;
  const b = levelBounds(level);
  const margin = dims ? 1.3 : 0.6;
  const vx0 = b.x0 - margin;
  const vz0 = b.z0 - margin;
  const vw = b.x1 - b.x0 + 2 * margin;
  const vh = b.z1 - b.z0 + 2 * margin;
  // grootste schaal die op A4 staand past (1 cm op papier = N cm in het echt)
  const fits = (n: number) => (vw * 1000) / n <= PAGE_W && (vh * 1000) / n <= PAGE_H;
  const scale = opts.scale ?? SCALES.find(fits) ?? 200;
  const mmW = (vw * 1000) / scale;
  const mmH = (vh * 1000) / scale;
  // tekstmaten in cm (tekening) zodat ze op papier ongeveer gelijk blijven
  const k = scale / 50;
  const parts: string[] = [];

  parts.push(`<defs><style>
    text { font-family: Inter, 'Helvetica Neue', Arial, sans-serif; fill: #1c1c1c; }
    .room { font-size: ${r1(13 * k)}px; font-weight: 600; letter-spacing: 0.02em; }
    .area { font-size: ${r1(10 * k)}px; fill: #555; }
    .dim { font-size: ${r1(10 * k)}px; fill: #333; }
    .item { font-size: ${r1(7.5 * k)}px; fill: #333; }
    .fx { font-size: ${r1(7 * k)}px; fill: #777; }
  </style></defs>`);
  parts.push(`<rect x="${r1(vx0 * 100)}" y="${r1(vz0 * 100)}" width="${r1(vw * 100)}" height="${r1(vh * 100)}" fill="#ffffff"/>`);

  // kamers
  for (const r of level.rooms) parts.push(poly(r.polygon, `fill="${FLOOR_TINT[r.floor] ?? '#f6f5f2'}" stroke="none"`));

  // vaste inbouw (hoog = gestippeld)
  for (const fx of level.fixtures) {
    if (fx.name === 'Inbouwspot') {
      // plafondspot: rondje met kruis (zoals op een installatietekening)
      const [x, z] = fx.position;
      const r = 7 * k;
      parts.push(
        `<g stroke="#8a8780" stroke-width="0.8" fill="none"><circle cx="${r1(x * 100)}" cy="${r1(z * 100)}" r="${r1(r)}"/><line x1="${r1(x * 100 - r)}" y1="${r1(z * 100)}" x2="${r1(x * 100 + r)}" y2="${r1(z * 100)}"/><line x1="${r1(x * 100)}" y1="${r1(z * 100 - r)}" x2="${r1(x * 100)}" y2="${r1(z * 100 + r)}"/></g>`,
      );
      continue;
    }
    const c = corners({ x: fx.position[0], z: fx.position[1], hw: fx.recipe.size.width / 2, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 });
    const high = (fx.y ?? 0) > 1.2;
    parts.push(poly(c, `fill="${high ? 'none' : '#e9e7e2'}" stroke="#8a8780" stroke-width="0.8"${high ? ' stroke-dasharray="5 4"' : ''}`));
    if (fx.name === 'Trap' || fx.name.startsWith('Trap')) {
      // treden aangeven
      const steps = 12;
      const w = fx.recipe.size.width;
      for (let i = 1; i < steps; i++) {
        const u = -w / 2 + (w * i) / steps;
        const c2 = corners({ x: fx.position[0], z: fx.position[1], hw: 0, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 });
        const ax = [Math.cos(((fx.rotation ?? 0) * Math.PI) / 180), -Math.sin(((fx.rotation ?? 0) * Math.PI) / 180)];
        const p1: V2 = [c2[0][0] + ax[0] * u, c2[0][1] + ax[1] * u];
        const p2: V2 = [c2[3][0] + ax[0] * u, c2[3][1] + ax[1] * u];
        parts.push(`<line x1="${r1(p1[0] * 100)}" y1="${r1(p1[1] * 100)}" x2="${r1(p2[0] * 100)}" y2="${r1(p2[1] * 100)}" stroke="#a7a49d" stroke-width="0.6"/>`);
      }
    }
  }

  // meubels
  if (furniture) {
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const p of placements.filter((q) => q.levelId === level.id)) {
      const it = itemMap.get(p.itemId);
      if (!it) continue;
      const s = it.recipe.size;
      const c = corners({ x: p.x, z: p.z, hw: s.width / 2, hd: s.depth / 2, rot: p.rotation });
      const rug = s.height <= 0.03;
      const raised = (p.y ?? 0) + (it.recipe.elevation ?? 0) >= 0.9;
      parts.push(poly(c, `fill="${rug ? 'none' : '#ffffff'}" fill-opacity="0.92" stroke="#3a3a3a" stroke-width="${rug ? 0.7 : 1}"${rug || raised ? ' stroke-dasharray="6 4"' : ''}`));
      // voorkant: dikkere lijn
      if (!rug) parts.push(`<line x1="${r1(c[3][0] * 100)}" y1="${r1(c[3][1] * 100)}" x2="${r1(c[2][0] * 100)}" y2="${r1(c[2][1] * 100)}" stroke="#3a3a3a" stroke-width="2"/>`);
      // naam als die erin past
      const maxChars = Math.floor((Math.max(s.width, s.depth) * 100) / (7.5 * k * 0.58));
      if (maxChars >= 4) {
        const name = it.name.length > maxChars ? `${it.name.slice(0, maxChars - 1)}…` : it.name;
        const along = s.depth > s.width * 1.3;
        const rot = ((along ? p.rotation + 90 : p.rotation) % 180 + 180) % 180;
        const textRot = rot > 90 ? rot - 180 : rot;
        parts.push(
          `<text x="${r1(p.x * 100)}" y="${r1(p.z * 100)}" text-anchor="middle" dominant-baseline="central" class="item" transform="rotate(${r1(-textRot)} ${r1(p.x * 100)} ${r1(p.z * 100)})">${esc(name)}</text>`,
        );
      }
    }
  }

  // muren, ramen, deuren
  for (const w of level.walls) parts.push(wallSvg(w));

  // kamernamen, oppervlakte en maten
  for (const r of level.rooms) {
    const c = r.label ?? roomCenter(r);
    const bb = roomBox(r);
    const area = polygonArea(r.polygon);
    const small = area < 2.5;
    parts.push(`<text x="${r1(c[0] * 100)}" y="${r1(c[1] * 100 - (small ? 0 : 6 * k))}" text-anchor="middle" class="room">${esc(r.name.toUpperCase())}</text>`);
    if (!small)
      parts.push(
        `<text x="${r1(c[0] * 100)}" y="${r1(c[1] * 100 + 9 * k)}" text-anchor="middle" class="area">${area.toFixed(1).replace('.', ',')} m²${dims ? ` · ${fmtM(bb.x1 - bb.x0)} × ${fmtM(bb.z1 - bb.z0)}` : ''}</text>`,
      );
  }

  // buitenmaten
  if (dims) {
    parts.push(dimLine([b.x0, b.z1], [b.x1, b.z1], [0, 0.7], `${fmtM(b.x1 - b.x0)} m`));
    parts.push(dimLine([b.x1, b.z0], [b.x1, b.z1], [0.7, 0], `${fmtM(b.z1 - b.z0)} m`));
  }

  // noordpijl en schaalstok (linksboven)
  const nx = vx0 + 0.45;
  const nz = vz0 + 0.5;
  const [hx, hz] = house.north;
  const ang = (Math.atan2(hx, -hz) * 180) / Math.PI;
  parts.push(
    `<g transform="translate(${r1(nx * 100)} ${r1(nz * 100)}) rotate(${r1(ang)})"><path d="M0 ${r1(-22 * k)} L${r1(8 * k)} ${r1(12 * k)} L0 ${r1(5 * k)} L${r1(-8 * k)} ${r1(12 * k)} Z" fill="#1c1c1c"/><text x="0" y="${r1(-26 * k)}" text-anchor="middle" class="dim" font-weight="700">N</text></g>`,
  );
  const sx = vx0 + 0.9;
  const sz = vz0 + 0.55;
  parts.push(
    `<rect x="${r1(sx * 100)}" y="${r1(sz * 100)}" width="50" height="${r1(4 * k)}" fill="#1c1c1c"/><rect x="${r1(sx * 100 + 50)}" y="${r1(sz * 100)}" width="50" height="${r1(4 * k)}" fill="#fff" stroke="#1c1c1c" stroke-width="0.8"/><text x="${r1(sx * 100)}" y="${r1(sz * 100 - 4 * k)}" class="dim">0</text><text x="${r1(sx * 100 + 100)}" y="${r1(sz * 100 - 4 * k)}" text-anchor="middle" class="dim">1 m</text>`,
  );

  const title = `${house.name} — ${level.name}`;
  const sub = `Schaal 1:${scale} (A4)${opts.date ? ` · ${opts.date}` : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(mmW)}mm" height="${r1(mmH)}mm" viewBox="${r1(vx0 * 100)} ${r1(vz0 * 100)} ${r1(vw * 100)} ${r1(vh * 100)}" data-title="${esc(title)}" data-sub="${esc(sub)}" data-scale="${scale}">${parts.join('')}</svg>`;
}

/** hele HTML-pagina om af te drukken (één verdieping per A4) */
export function floorplanPrintHtml(house: House, svgs: { title: string; sub: string; svg: string }[]): string {
  const pages = svgs
    .map(
      (s) => `<section class="page"><header><h1>${esc(s.title)}</h1><p>${esc(s.sub)}</p></header><div class="plan">${s.svg}</div></section>`,
    )
    .join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Plattegrond ${esc(house.name)}</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, 'Helvetica Neue', Arial, sans-serif; color: #1c1c1c; }
    .page { width: 190mm; height: 277mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.4mm solid #1c1c1c; padding-bottom: 2mm; margin-bottom: 3mm; }
    h1 { font-size: 13pt; margin: 0; font-weight: 600; }
    header p { margin: 0; font-size: 9pt; color: #555; }
    .plan { flex: 1; display: flex; align-items: flex-start; justify-content: center; }
    @media screen { body { background: #ddd; } .page { background: #fff; margin: 10mm auto; padding: 10mm; width: 210mm; height: 297mm; } }
  </style></head><body>${pages}</body></html>`;
}
