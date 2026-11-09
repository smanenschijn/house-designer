import type { House, Level, Room, V2 } from './house';
import type { Item, Part, Placement, Recipe } from './recipe';
import { corners, pointInPolygon, rectsOverlap, wallRects } from './placement';
import { roomFaces } from './walls';

const DEG = Math.PI / 180;

export const placementRect = (p: Placement, it: Item) => ({
  x: p.x,
  z: p.z,
  hw: it.recipe.size.width / 2,
  hd: it.recipe.size.depth / 2,
  rot: p.rotation,
});

/**
 * Botsingen op een verdieping: per plaatsing een lijst van waarmee hij overlapt
 * ("muur", "vaste inbouw: Schiereiland", of de naam van een ander meubel).
 * Vloerkleden (≤ 3 cm hoog) tellen niet mee.
 */
export function findCollisions(house: House, levelId: string, placements: Placement[], items: Item[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const level = house.levels.find((l) => l.id === levelId);
  if (!level) return out;
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const list = placements
    .filter((p) => p.levelId === levelId)
    .map((p) => ({ p, it: itemMap.get(p.itemId) }))
    .filter((x): x is { p: Placement; it: Item } => !!x.it && x.it.recipe.size.height > 0.03);
  const polys = list.map(({ p, it }) => corners(placementRect(p, it)));
  const obstacles: { name: string; poly: V2[] }[] = level.walls.flatMap((w) => wallRects(w).map((poly) => ({ name: 'muur', poly })));
  for (const fx of level.fixtures)
    if ((fx.y ?? 0) < 1.0 && fx.recipe.size.height > 0.05)
      obstacles.push({
        name: `vaste inbouw: ${fx.name}`,
        poly: corners({ x: fx.position[0], z: fx.position[1], hw: fx.recipe.size.width / 2, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 }),
      });
  const add = (id: string, what: string) => {
    const l = out.get(id) ?? [];
    if (!l.includes(what)) l.push(what);
    out.set(id, l);
  };
  list.forEach(({ p, it }, i) => {
    const elev = (p.y ?? 0) + (it.recipe.elevation ?? 0);
    for (let j = i + 1; j < list.length; j++) {
      const o = list[j];
      const oElev = (o.p.y ?? 0) + (o.it.recipe.elevation ?? 0);
      if (elev >= oElev + o.it.recipe.size.height - 0.01 || oElev >= elev + it.recipe.size.height - 0.01) continue;
      if (rectsOverlap(polys[i], polys[j], 0.01)) {
        add(p.id, o.it.name);
        add(o.p.id, it.name);
      }
    }
    for (const ob of obstacles) if (rectsOverlap(polys[i], ob.poly, 0.01)) add(p.id, ob.name);
  });
  return out;
}

// ---------- recepten controleren ----------

/** Asgebonden omhullende van een recept, berekend uit de onderdelen (incl. rotaties). */
export function recipeBounds(recipe: Recipe) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of recipe.parts) {
    const pts = partCorners(p);
    for (const c of pts)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], c[k]);
        max[k] = Math.max(max[k], c[k]);
      }
  }
  return { min, max, width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2] };
}

function partCorners(p: Part): number[][] {
  // halve maten van het onderdeel in eigen assen
  let h: [number, number, number];
  let yOffset = 0;
  switch (p.shape) {
    case 'box':
      h = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
      break;
    case 'cylinder': {
      const r = Math.max(p.radiusTop ?? p.radius ?? 0.05, p.radiusBottom ?? p.radius ?? 0.05);
      h = [r, p.height / 2, r];
      break;
    }
    case 'sphere': {
      const s = p.scale ?? [1, 1, 1];
      h = [p.radius * s[0], p.radius * s[1], p.radius * s[2]];
      break;
    }
    case 'torus':
      h = [p.radius + p.tube, p.radius + p.tube, p.tube];
      break;
    case 'extrude': {
      const xs = p.points.map((q) => q[0]);
      const ys = p.points.map((q) => q[1]);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      h = [(Math.max(...xs) - Math.min(...xs)) / 2 + (p.bevel ?? 0), (Math.max(...ys) - Math.min(...ys)) / 2 + (p.bevel ?? 0), p.depth / 2 + (p.bevel ?? 0)];
      return boxCorners(h, p, [cx, cy, 0]);
    }
    case 'lathe': {
      const r = Math.max(...p.points.map((q) => q[0]));
      const ys = p.points.map((q) => q[1]);
      h = [r, (Math.max(...ys) - Math.min(...ys)) / 2, r];
      yOffset = (Math.max(...ys) + Math.min(...ys)) / 2;
      return boxCorners(h, p, [0, yOffset, 0]);
    }
  }
  return boxCorners(h, p, [0, 0, 0]);
}

function boxCorners(h: [number, number, number], p: Part, localCenter: [number, number, number]): number[][] {
  const [rx, ry, rz] = (p.rotation ?? [0, 0, 0]).map((d) => d * DEG);
  const pos = p.position ?? [0, 0, 0];
  const out: number[][] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        let x = localCenter[0] + sx * h[0];
        let y = localCenter[1] + sy * h[1];
        let z = localCenter[2] + sz * h[2];
        // Euler XYZ (three.js): eerst Z, dan Y, dan X toegepast op de vector
        let t: number;
        t = x * Math.cos(rz) - y * Math.sin(rz); y = x * Math.sin(rz) + y * Math.cos(rz); x = t;
        t = x * Math.cos(ry) + z * Math.sin(ry); z = -x * Math.sin(ry) + z * Math.cos(ry); x = t;
        t = y * Math.cos(rx) - z * Math.sin(rx); z = y * Math.sin(rx) + z * Math.cos(rx); y = t;
        out.push([x + pos[0], y + pos[1], z + pos[2]]);
      }
  return out;
}

/** Waarschuwingen als de onderdelen niet passen bij de opgegeven maten of de oorsprong. */
export function checkRecipe(recipe: Recipe): string[] {
  const w: string[] = [];
  const b = recipeBounds(recipe);
  const s = recipe.size;
  const tol = 0.02;
  const cm = (v: number) => `${Math.round(v * 100)} cm`;
  if (Math.abs(b.width - s.width) > tol) w.push(`Breedte van de onderdelen is ${cm(b.width)}, opgegeven ${cm(s.width)}.`);
  if (Math.abs(b.depth - s.depth) > tol) w.push(`Diepte van de onderdelen is ${cm(b.depth)}, opgegeven ${cm(s.depth)}.`);
  if (Math.abs(b.height - s.height) > tol) w.push(`Hoogte van de onderdelen is ${cm(b.height)}, opgegeven ${cm(s.height)}.`);
  if (b.min[1] < -0.005) w.push(`Onderdelen steken ${cm(-b.min[1])} onder de vloer (y < 0). De oorsprong moet de onderkant zijn.`);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  if (Math.abs(cx) > tol || Math.abs(cz) > tol) w.push(`Het meubel is niet gecentreerd rond x=0, z=0 (midden op x=${cx.toFixed(2)}, z=${cz.toFixed(2)}).`);
  for (const p of recipe.parts) if (!recipe.materials[p.material]) w.push(`Materiaal "${p.material}" van onderdeel ${p.name ?? p.shape} bestaat niet.`);
  return w;
}

// ---------- huis beschrijven (voor Claude) ----------

export function polygonArea(poly: V2[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function roomBox(r: Room) {
  const xs = r.polygon.map((p) => p[0]);
  const zs = r.polygon.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

export function roomCenter(r: Room): V2 {
  if (r.label) return r.label;
  const b = roomBox(r);
  return [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
}

export function findRoom(house: House, query: string): { level: Level; room: Room } | null {
  const q = query.trim().toLowerCase();
  for (const level of house.levels)
    for (const room of level.rooms) if (room.id === q || room.name.toLowerCase() === q) return { level, room };
  for (const level of house.levels)
    for (const room of level.rooms) if (room.name.toLowerCase().includes(q) || room.id.includes(q)) return { level, room };
  return null;
}

export function roomOf(level: Level, x: number, z: number) {
  return level.rooms.find((r) => pointInPolygon([x, z], r.polygon)) ?? null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Gestructureerde beschrijving van het huis met maten, ramen/deuren per kamer en vaste inbouw. */
export function describeHouse(house: House) {
  return {
    name: house.name,
    coordinates:
      'Meters. x loopt van links (noord, carportzijde) naar rechts (zuid, buren); z loopt van achter (oost, tuin) naar voor (west, straat). ' +
      'Rotatie in graden om de verticale as: 0 = voorkant meubel naar +z (straat), 90 = naar +x (zuid), 180 = naar -z (tuin), -90/270 = naar -x (noord).',
    orientation: 'Voorgevel op het westen (straat), tuin op het oosten. De rechtermuur (x ≈ 5,53) is de woningscheidende muur met nr. 14.',
    levels: house.levels.map((level) => ({
      id: level.id,
      name: level.name,
      floorHeight: level.elevation,
      ceilingHeight: r2(level.ceilingHeight),
      rooms: level.rooms
        .filter((r) => polygonArea(r.polygon) > 1)
        .map((r) => {
          const b = roomBox(r);
          const openings: string[] = [];
          for (const w of level.walls)
            for (const o of w.openings ?? []) {
              const dx = w.b[0] - w.a[0];
              const dz = w.b[1] - w.a[1];
              const len = Math.hypot(dx, dz);
              const px = w.a[0] + (dx / len) * o.at;
              const pz = w.a[1] + (dz / len) * o.at;
              // opening hoort bij de kamer als een punt net binnen de kamer ligt
              const nx = -dz / len;
              const nz = dx / len;
              const near = [1, -1].some((s) => pointInPolygon([px + nx * s * (w.thickness / 2 + 0.15), pz + nz * s * (w.thickness / 2 + 0.15)], r.polygon));
              if (!near) continue;
              const kind = { window: 'raam', door: 'deur', frontDoor: 'voordeur', glassDoor: 'glazen deur', passage: 'doorgang' }[o.kind];
              openings.push(
                `${kind} ${Math.round(o.width * 100)} cm breed bij (x=${r2(px)}, z=${r2(pz)})${o.kind === 'window' ? `, borstwering ${Math.round((o.sill ?? 0) * 100)} cm` : ''}`,
              );
            }
          return {
            id: r.id,
            name: r.name,
            floor: r.floor,
            area_m2: r2(polygonArea(r.polygon)),
            bounds: { x: [r2(b.x0), r2(b.x1)], z: [r2(b.z0), r2(b.z1)] },
            polygon: r.polygon.map(([x, z]) => [r2(x), r2(z)]),
            walls: roomFaces(house, level, r).map((f) => `${f.direction}: ${f.length} m`),
            openings,
          };
        }),
      fixtures: level.fixtures
        .filter((f) => f.name !== 'Inbouwspot')
        .map((f) => ({
          name: f.name,
          position: [r2(f.position[0]), r2(f.position[1])],
          size_cm: [Math.round(f.recipe.size.width * 100), Math.round(f.recipe.size.depth * 100), Math.round(f.recipe.size.height * 100)],
          rotation: f.rotation ?? 0,
        })),
      ceiling_spots: level.fixtures.filter((f) => f.name === 'Inbouwspot').map((f) => [r2(f.position[0]), r2(f.position[1])]),
    })),
    assumptions: house.assumptions,
  };
}
