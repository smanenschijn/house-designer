import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkRecipe, describeHouse, findCollisions, findRoom, roomCenter, roomOf } from '../shared/analysis';
import { snapToWalls } from '../shared/placement';
import { CATEGORIES, FINISHES, RecipeSchema, STATUSES, type Item, type Recipe } from '../shared/recipe';
import { TEMPLATES, TEMPLATE_MAP, buildFromTemplate } from '../shared/templates';
import { waalstraat16 as house } from '../shared/waalstraat16';
import type { PublicUser } from './auth';
import {
  createItem,
  createPlacement,
  deleteItem,
  deletePlacement,
  getItem,
  getPlacement,
  listItems,
  listPlacements,
  updateItem,
  updatePlacement,
} from './db';
import { setActor } from './events';
import { activateVariant, activeMap, createVariant, getVariant, listVariants, updateVariant } from './variants';
import {
  FLOOR_LABELS,
  INDOOR_FLOORS,
  WALLPAPERS,
  WALL_COLORS,
  activeVariantFor,
  describeWallFinish,
  faceKey,
  isPlacementVisible,
  roomWallFinish,
  type WallFinish,
  type WallpaperId,
} from '../shared/variants';
import { roomFaces } from '../shared/walls';
import type { FloorMaterial } from '../shared/house';

const visible = () => {
  const vs = listVariants();
  const act = activeMap();
  return listPlacements().filter((p) => isPlacementVisible(p.variantId, vs, act));
};
import { renderView } from './render';

const INSTRUCTIONS = `Dit is de inrichtingsapp voor Waalstraat 16 in Nijverdal (twee-onder-een-kap, begane grond, eerste verdieping, zolder).
Gebruik get_house voor de plattegrond met maten. Meubels maak je als "recept": eenvoudige 3D-vormen op exacte maten (zie create_furniture_item).
Gebruik altijd de echte maten van het product (breedte × diepte × hoogte); zoek die op als de gebruiker een link of productnaam geeft.
Plaats meubels met place_furniture en controleer met render_view hoe het eruitziet.
Elke kamer kan meerdere varianten hebben (list_room_variants). Wil de gebruiker een alternatief proberen, maak dan eerst een variant (create_room_variant) zodat de huidige opstelling bewaard blijft. Vloer en wandkleur stel je in met set_room_finish.
Antwoord de gebruiker in het Nederlands.`;

const RECIPE_GUIDE = `Recept (JSON), alles in meters:
- size: { width (x), depth (z), height (y) } = buitenmaten van het meubel.
- Oorsprong = midden van de ONDERKANT. x van -width/2 tot +width/2, z van -depth/2 tot +depth/2, y van 0 tot height. De VOORKANT (zitkant, deuren) wijst naar +z.
- materials: { naam: { color: "#rrggbb", finish } }, finish ∈ ${FINISHES.join(', ')}. Optioneel opacity (0–1).
- parts: lijst onderdelen met position = MIDDEN van het onderdeel [x,y,z], optioneel rotation [rx,ry,rz] in graden, en material (naam uit materials):
  • box: size [x,y,z], optioneel radius (afronding, bv. 0.03 voor kussens)
  • cylinder: radius (of radiusTop/radiusBottom), height (langs y)
  • sphere: radius, optioneel scale [sx,sy,sz] (ellipsoïde; radius 0.5 + scale = maten)
  • torus: radius, tube, optioneel arc (graden)
  • extrude: points [[x,y],...] profiel in XY, depth langs z (gecentreerd)
  • lathe: points [[straal,y],...] gedraaid rond de y-as
- Tip: bouw herkenbaar maar eenvoudig (10–40 onderdelen): frame, kussens, poten, grepen, naden. Houd alle onderdelen binnen size.`;

const fmtCm = (r: Recipe) => `${Math.round(r.size.width * 100)} × ${Math.round(r.size.depth * 100)} × ${Math.round(r.size.height * 100)} cm`;

function resolveLevel(q: string | undefined) {
  if (!q) return null;
  const s = q.trim().toLowerCase();
  return (
    house.levels.find((l) => l.id === s || l.name.toLowerCase() === s || l.short.toLowerCase() === s) ??
    (/^(0|bg|begane|beneden)/.test(s) ? house.levels[0] : /^(1|eerste|boven|verdieping)/.test(s) ? house.levels[1] : /^(2|zolder)/.test(s) ? house.levels[2] : null)
  );
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

function itemSummary(it: Item, counts: Map<string, number>) {
  return {
    id: it.id,
    name: it.name,
    category: it.category,
    size_cm: fmtCm(it.recipe),
    status: it.meta.status,
    price: it.meta.price ?? null,
    shop: it.meta.shop ?? null,
    url: it.meta.url ?? null,
    placed: counts.get(it.id) ?? 0,
  };
}

function placementInfo(pid: string) {
  const p = getPlacement(pid);
  if (!p) return null;
  const it = getItem(p.itemId);
  const level = house.levels.find((l) => l.id === p.levelId)!;
  const room = roomOf(level, p.x, p.z);
  const collisions = findCollisions(house, p.levelId, visible(), listItems()).get(p.id) ?? [];
  const variant = getVariant(p.variantId);
  return {
    placement_id: p.id,
    item_id: p.itemId,
    name: it?.name,
    size_cm: it ? fmtCm(it.recipe) : undefined,
    level: level.name,
    room: room?.name ?? 'buiten een kamer',
    x: Math.round(p.x * 100) / 100,
    z: Math.round(p.z * 100) / 100,
    rotation: Math.round(p.rotation),
    variant: variant ? `${variant.name}${isPlacementVisible(p.variantId, listVariants(), activeMap()) ? '' : ' (niet actief)'}` : 'buiten',
    collisions: collisions.length ? collisions : 'geen',
  };
}

export function buildMcpServer(user: PublicUser) {
  const server = new McpServer({ name: 'waalstraat-16', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const actor = (what: string) => setActor(`Claude (${user.displayName})`, what);

  // ---------- huis ----------
  server.registerTool(
    'get_house',
    {
      title: 'Plattegrond van het huis',
      description:
        'Geeft de plattegrond van Waalstraat 16: verdiepingen, kamers met maten (m), oppervlakte, ramen/deuren per kamer, vaste inbouw en het coördinatenstelsel. Roep dit eerst aan voordat je meubels plaatst.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(describeHouse(house)),
  );

  // ---------- bibliotheek ----------
  server.registerTool(
    'list_furniture_library',
    {
      title: 'Meubelbibliotheek',
      description: 'Lijst van alle meubels in de bibliotheek (eigen meubels en kandidaten), met maten, status, prijs en hoe vaak ze geplaatst zijn.',
      inputSchema: {
        search: z.string().optional().describe('zoekterm in naam/winkel'),
        status: z.enum(STATUSES).optional(),
        category: z.enum(CATEGORIES).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, status, category }) => {
      const counts = new Map<string, number>();
      for (const p of listPlacements()) counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
      const items = listItems().filter(
        (it) =>
          (!status || it.meta.status === status) &&
          (!category || it.category === category) &&
          (!search || `${it.name} ${it.meta.shop ?? ''}`.toLowerCase().includes(search.toLowerCase())),
      );
      return json(items.map((it) => itemSummary(it, counts)));
    },
  );

  server.registerTool(
    'get_furniture_item',
    {
      title: 'Meubel met recept',
      description: 'Volledige gegevens van één meubel, inclusief het 3D-recept (om het aan te passen).',
      inputSchema: { item_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ item_id }) => {
      const it = getItem(item_id);
      return it ? json(it) : fail('Meubel niet gevonden.');
    },
  );

  server.registerTool(
    'list_templates',
    {
      title: 'Sjablonen',
      description: 'Beschikbare parametrische sjablonen (snelle manier om een meubel te maken met alleen maten en kleuren).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json(
        TEMPLATES.map((t) => ({
          id: t.id,
          label: t.label,
          category: t.category,
          defaults_cm: { width: Math.round(t.defaults.width * 100), depth: Math.round(t.defaults.depth * 100), height: Math.round(t.defaults.height * 100) },
          color: t.colorLabel ?? 'kleur',
          accent: t.accentLabel ?? null,
          options: t.extra?.map((x) => ({ key: x.key, label: x.label, kind: x.kind, options: x.options, default: t.defaults[x.key] })) ?? [],
        })),
      ),
  );

  const metaShape = {
    status: z.enum(STATUSES).optional().describe('hebben = eigen meubel, overwegen = kandidaat'),
    price: z.number().min(0).optional().describe('prijs in euro'),
    shop: z.string().optional(),
    url: z.string().optional().describe('productpagina'),
    notes: z.string().optional(),
  };

  server.registerTool(
    'create_furniture_item',
    {
      title: 'Meubel maken (recept)',
      description: `Maakt een nieuw meubel in de bibliotheek uit een 3D-recept. Het verschijnt direct in de app.\n\n${RECIPE_GUIDE}\n\nNa het maken krijg je waarschuwingen terug als de onderdelen niet bij de maten passen; corrigeer die met update_furniture_item.`,
      inputSchema: {
        name: z.string().min(1).describe('bijv. "IKEA Söderhamn 3-zits, Tonerud grijs"'),
        category: z.enum(CATEGORIES),
        recipe: RecipeSchema,
        ...metaShape,
      },
    },
    async ({ name, category, recipe, status, price, shop, url, notes }) => {
      actor(`meubel “${name}” gemaakt`);
      const it = createItem({ name, category, recipe, meta: { status: status ?? 'overwegen', price, shop, url, notes } }, user.id);
      const warnings = checkRecipe(it.recipe);
      return json({ item_id: it.id, name: it.name, size_cm: fmtCm(it.recipe), warnings: warnings.length ? warnings : 'geen' });
    },
  );

  server.registerTool(
    'create_furniture_from_template',
    {
      title: 'Meubel maken (sjabloon)',
      description: 'Maakt snel een meubel uit een sjabloon (zie list_templates) met maten in cm en kleuren. Goed voor standaardmeubels; gebruik create_furniture_item voor iets specifiekers.',
      inputSchema: {
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]),
        name: z.string().min(1),
        width_cm: z.number().positive(),
        depth_cm: z.number().positive(),
        height_cm: z.number().positive(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('hoofdkleur #rrggbb'),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('tweede kleur (poten, grepen, …)'),
        options: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional().describe('extra sjabloonopties (zie list_templates)'),
        ...metaShape,
      },
    },
    async ({ template, name, width_cm, depth_cm, height_cm, color, accent, options, status, price, shop, url, notes }) => {
      const t = TEMPLATE_MAP[template];
      // lengte-opties (zitdiepte e.d.) worden in meters verwacht; accepteer ook cm
      const opts = Object.fromEntries(
        Object.entries(options ?? {}).map(([k, v]) => {
          const ex = t.extra?.find((x) => x.key === k);
          return [k, typeof v === 'number' && ex && (ex.step ?? 1) < 1 && v > 5 ? v / 100 : v];
        }),
      );
      const params = { ...t.defaults, ...opts, width: width_cm / 100, depth: depth_cm / 100, height: height_cm / 100, color, accent: accent ?? t.defaults.accent };
      const recipe = buildFromTemplate(template, params);
      actor(`meubel “${name}” gemaakt`);
      const it = createItem({ name, category: t.category, recipe, meta: { status: status ?? 'overwegen', price, shop, url, notes, template: { id: template, params } } }, user.id);
      return json({ item_id: it.id, name: it.name, size_cm: fmtCm(it.recipe) });
    },
  );

  server.registerTool(
    'update_furniture_item',
    {
      title: 'Meubel aanpassen',
      description: 'Past naam, recept of gegevens (status, prijs, winkel, link, notities) van een meubel aan. Geplaatste exemplaren veranderen mee.',
      inputSchema: {
        item_id: z.string(),
        name: z.string().optional(),
        category: z.enum(CATEGORIES).optional(),
        recipe: RecipeSchema.optional(),
        ...metaShape,
      },
    },
    async ({ item_id, name, category, recipe, status, price, shop, url, notes }) => {
      const cur = getItem(item_id);
      if (!cur) return fail('Meubel niet gevonden.');
      actor(`meubel “${name ?? cur.name}” aangepast`);
      const meta = Object.fromEntries(Object.entries({ status, price, shop, url, notes }).filter(([, v]) => v !== undefined));
      const it = updateItem(item_id, {
        ...(name ? { name } : {}),
        ...(category ? { category } : {}),
        ...(recipe ? { recipe, meta: { ...cur.meta, ...meta, template: null } } : { meta: { ...cur.meta, ...meta } }),
      })!;
      const warnings = recipe ? checkRecipe(it.recipe) : [];
      return json({ item_id: it.id, name: it.name, size_cm: fmtCm(it.recipe), warnings: warnings.length ? warnings : 'geen' });
    },
  );

  server.registerTool(
    'delete_furniture_item',
    {
      title: 'Meubel verwijderen',
      description: 'Verwijdert een meubel uit de bibliotheek, inclusief alle plaatsingen. Vraag eerst bevestiging aan de gebruiker.',
      inputSchema: { item_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ item_id }) => {
      const it = getItem(item_id);
      if (!it) return fail('Meubel niet gevonden.');
      actor(`meubel “${it.name}” verwijderd`);
      deleteItem(item_id);
      return text(`“${it.name}” is verwijderd.`);
    },
  );

  // ---------- plaatsen ----------
  server.registerTool(
    'list_placed_furniture',
    {
      title: 'Geplaatste meubels',
      description: 'Welke meubels staan waar (verdieping, kamer, positie, rotatie, variant) en of ze ergens mee botsen. Standaard alleen de actieve varianten.',
      inputSchema: {
        level: z.string().optional().describe('bg, 1e of zolder'),
        room: z.string().optional(),
        include_inactive: z.boolean().optional().describe('ook meubels uit niet-actieve varianten'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ level, room, include_inactive }) => {
      const lv = resolveLevel(level);
      const list = (include_inactive ? listPlacements() : visible())
        .filter((p) => !lv || p.levelId === lv.id)
        .map((p) => placementInfo(p.id)!)
        .filter((p) => !room || p.room.toLowerCase().includes(room.toLowerCase()));
      return json(list);
    },
  );

  server.registerTool(
    'place_furniture',
    {
      title: 'Meubel plaatsen',
      description:
        'Plaatst een meubel uit de bibliotheek in het huis. Geef een kamer (dan midden in de kamer, tenzij x/z gegeven) of exacte coördinaten x/z in meters (zie get_house). ' +
        'rotation in graden: 0 = voorkant naar +z (straatkant), 90 = naar +x (zuid/buren), 180 = naar -z (tuin), 270 = naar -x (noord). ' +
        'Met snap_to_wall (standaard aan) schuift het meubel strak tegen een muur als het daar binnen 25 cm van staat. Je krijgt botsingen terug.',
      inputSchema: {
        item_id: z.string(),
        room: z.string().optional().describe('kamernaam of id, bijv. "woonkamer"'),
        level: z.string().optional().describe('bg, 1e of zolder (nodig bij x/z zonder kamer)'),
        x: z.number().optional(),
        z: z.number().optional(),
        rotation: z.number().optional(),
        snap_to_wall: z.boolean().optional(),
      },
    },
    async ({ item_id, room, level, x, z: zz, rotation, snap_to_wall }) => {
      const it = getItem(item_id);
      if (!it) return fail('Meubel niet gevonden.');
      let lv = resolveLevel(level);
      let px = x;
      let pz = zz;
      if (room) {
        const found = findRoom(house, room);
        if (!found) return fail(`Kamer “${room}” niet gevonden. Kamers: ${house.levels.flatMap((l) => l.rooms.map((r) => r.name)).join(', ')}`);
        lv = found.level;
        if (px === undefined || pz === undefined) [px, pz] = roomCenter(found.room);
      }
      if (!lv) lv = house.levels[0];
      if (px === undefined || pz === undefined) return fail('Geef een kamer of x en z.');
      let rot = rotation ?? 0;
      if (snap_to_wall !== false) {
        const s = snapToWalls({ x: px, z: pz, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot }, lv, 0.25);
        px = s.x;
        pz = s.z;
        rot = s.rot;
      }
      actor(`“${it.name}” geplaatst`);
      const p = createPlacement({ itemId: it.id, levelId: lv.id, x: px, z: pz, rotation: rot }, user.id);
      return json(placementInfo(p.id));
    },
  );

  server.registerTool(
    'move_furniture',
    {
      title: 'Meubel verplaatsen/draaien',
      description: 'Verplaatst of draait een geplaatst meubel (placement_id uit list_placed_furniture of place_furniture). Alleen opgegeven velden veranderen.',
      inputSchema: {
        placement_id: z.string(),
        x: z.number().optional(),
        z: z.number().optional(),
        rotation: z.number().optional(),
        level: z.string().optional(),
        snap_to_wall: z.boolean().optional(),
      },
    },
    async ({ placement_id, x, z: zz, rotation, level, snap_to_wall }) => {
      const p = getPlacement(placement_id);
      if (!p) return fail('Plaatsing niet gevonden.');
      const it = getItem(p.itemId)!;
      const lv = resolveLevel(level) ?? house.levels.find((l) => l.id === p.levelId)!;
      let nx = x ?? p.x;
      let nz = zz ?? p.z;
      let rot = rotation ?? p.rotation;
      if (snap_to_wall !== false) {
        const s = snapToWalls({ x: nx, z: nz, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot }, lv, 0.25);
        nx = s.x;
        nz = s.z;
        rot = s.rot;
      }
      actor(`“${it.name}” verplaatst`);
      updatePlacement(placement_id, { x: nx, z: nz, rotation: rot, levelId: lv.id });
      return json(placementInfo(placement_id));
    },
  );

  server.registerTool(
    'remove_furniture',
    {
      title: 'Meubel weghalen',
      description: 'Haalt een geplaatst meubel weg uit het huis (het blijft in de bibliotheek).',
      inputSchema: { placement_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ placement_id }) => {
      const info = placementInfo(placement_id);
      if (!info) return fail('Plaatsing niet gevonden.');
      actor(`“${info.name}” weggehaald`);
      deletePlacement(placement_id);
      return text(`“${info.name}” is weggehaald uit ${info.room}.`);
    },
  );

  // ---------- varianten en afwerking ----------
  const roomOrFail = (q: string) => findRoom(house, q);

  server.registerTool(
    'list_room_variants',
    {
      title: 'Varianten per kamer',
      description:
        'Toont per kamer de varianten (bijv. "Standaard", "Met hoekbank"), welke actief is, hoeveel meubels erin staan en de afwerking (vloer, wandkleur). Alleen de actieve variant is zichtbaar in de app.',
      inputSchema: { room: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ room }) => {
      const act = activeMap();
      const all = listVariants();
      const placements = listPlacements();
      const rooms = house.levels.flatMap((l) => l.rooms.map((r) => ({ l, r }))).filter(({ r }) => !room || roomOrFail(room)?.room.id === r.id);
      return json(
        rooms.map(({ l, r }) => ({
          room: r.name,
          room_id: r.id,
          level: l.name,
          variants: all
            .filter((v) => v.roomId === r.id)
            .map((v) => ({
              variant_id: v.id,
              name: v.name,
              active: activeVariantFor(act, r.id) === v.id,
              furniture: placements.filter((p) => p.variantId === v.id).length,
              floor: FLOOR_LABELS[v.finish.floor ?? r.floor],
              walls: describeWallFinish(roomWallFinish(v.finish)),
              accent_walls: Object.keys(v.finish.faces ?? {}).length,
            })),
        })),
      );
    },
  );

  server.registerTool(
    'create_room_variant',
    {
      title: 'Nieuwe variant voor een kamer',
      description:
        'Maakt een nieuwe variant voor een kamer en zet die actief. Met copy_current (standaard aan) worden de meubels en afwerking van de huidige variant gekopieerd, zodat je daarna kunt schuiven en vervangen zonder het origineel kwijt te raken.',
      inputSchema: { room: z.string(), name: z.string().min(1), copy_current: z.boolean().optional() },
    },
    async ({ room, name, copy_current }) => {
      const found = roomOrFail(room);
      if (!found) return fail(`Kamer “${room}” niet gevonden.`);
      actor(`variant “${name}” voor ${found.room.name}`);
      const v = createVariant(
        { roomId: found.room.id, name, copyFrom: copy_current === false ? undefined : activeVariantFor(activeMap(), found.room.id) },
        user.id,
      );
      return json({ variant_id: v.id, name: v.name, room: found.room.name, active: true });
    },
  );

  server.registerTool(
    'activate_room_variant',
    {
      title: 'Variant tonen',
      description: 'Maakt een variant actief (zichtbaar in de app) voor de kamer waar hij bij hoort.',
      inputSchema: { variant_id: z.string() },
    },
    async ({ variant_id }) => {
      const v = getVariant(variant_id);
      if (!v) return fail('Variant niet gevonden.');
      actor(`variant “${v.name}” getoond`);
      activateVariant(variant_id);
      return text(`Variant “${v.name}” is nu actief.`);
    },
  );

  server.registerTool(
    'set_room_finish',
    {
      title: 'Vloer, verf of behang',
      description:
        `Past de afwerking van een kamer aan (in de actieve variant). Vloeren: ${INDOOR_FLOORS.join(', ')}. ` +
        `Muren: verf (wall_color, #rrggbb; bijv. ${WALL_COLORS.map((c) => `${c.name} ${c.hex}`).join(', ')}) of behang (wallpaper: pattern ${WALLPAPERS.map((p) => p.id).join('/')} met color = achtergrond en accent = motief). ` +
        'Zonder wall geldt het voor alle wanden van de kamer; met wall (bijv. "oost") alleen voor de muur/muren in die windrichting (accentmuur). Zie get_house voor de muren per kamer. reset_walls haalt alle accentmuren weg.',
      inputSchema: {
        room: z.string(),
        floor: z.enum(INDOOR_FLOORS as [FloorMaterial, ...FloorMaterial[]]).optional(),
        wall_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        wallpaper: z
          .object({
            pattern: z.enum(WALLPAPERS.map((p) => p.id) as [WallpaperId, ...WallpaperId[]]),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          })
          .optional(),
        wall: z.enum(['noord', 'noordoost', 'oost', 'zuidoost', 'zuid', 'zuidwest', 'west', 'noordwest']).optional().describe('alleen de muur in deze richting'),
        reset_walls: z.boolean().optional(),
      },
    },
    async ({ room, floor, wall_color, wallpaper, wall, reset_walls }) => {
      const found = roomOrFail(room);
      if (!found) return fail(`Kamer “${room}” niet gevonden.`);
      const id = activeVariantFor(activeMap(), found.room.id);
      const cur = getVariant(id)!;
      let finish: WallFinish | null = null;
      if (wallpaper) {
        const def = WALLPAPERS.find((p) => p.id === wallpaper.pattern)!;
        finish = { kind: 'wallpaper', pattern: wallpaper.pattern, color: wallpaper.color ?? def.color, accent: wallpaper.accent ?? def.accent };
      } else if (wall_color) finish = { kind: 'paint', color: wall_color };
      const patch: Record<string, unknown> = {};
      if (floor) patch.floor = floor;
      if (reset_walls) patch.faces = Object.fromEntries(Object.keys(cur.finish.faces ?? {}).map((k) => [k, null]));
      let applied = 'hele kamer';
      if (finish && wall) {
        const faces = roomFaces(house, found.level, found.room).filter((f) => f.direction === wall);
        if (!faces.length) {
          const dirs = [...new Set(roomFaces(house, found.level, found.room).map((f) => f.direction))].join(', ');
          return fail(`Geen muur in richting “${wall}” in ${found.room.name}. Wel: ${dirs}.`);
        }
        patch.faces = { ...((patch.faces as object) ?? {}), ...Object.fromEntries(faces.map((f) => [faceKey(f.wallId, f.side), finish])) };
        applied = `muur aan de ${wall}kant (${faces.map((f) => `${f.length} m`).join(' + ')})`;
      } else if (finish) patch.wall = finish;
      actor(`afwerking ${found.room.name} aangepast`);
      const v = updateVariant(id, { finish: patch });
      return json({
        room: found.room.name,
        variant: v.name,
        floor: FLOOR_LABELS[v.finish.floor ?? found.room.floor],
        walls: describeWallFinish(roomWallFinish(v.finish)),
        accent_walls: Object.keys(v.finish.faces ?? {}).length,
        applied_to: finish ? applied : undefined,
      });
    },
  );

  // ---------- kijken ----------
  server.registerTool(
    'render_view',
    {
      title: 'Afbeelding van het huis',
      description:
        'Maakt een afbeelding van een verdieping of kamer zoals in de app (isometrisch of in perspectief), om te controleren hoe meubels staan. ' +
        'Gebruik dit na het plaatsen. azimuth = kijkrichting in graden (0 = vanaf de straat, 90 = vanaf de buren/zuid, 180 = vanaf de tuin, 270 = vanaf de carport/noord).',
      inputSchema: {
        room: z.string().optional(),
        level: z.string().optional(),
        camera: z.enum(['iso', 'perspective']).optional(),
        azimuth: z.number().optional(),
        time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('tijd voor de zonnestand, bijv. 15:00'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ room, level, camera, azimuth, time, date }) => {
      let lv = resolveLevel(level);
      let roomId: string | undefined;
      if (room) {
        const found = findRoom(house, room);
        if (!found) return fail(`Kamer “${room}” niet gevonden.`);
        lv = found.level;
        roomId = found.room.id;
      }
      try {
        const jpeg = await renderView(user, {
          level: house.levels.indexOf(lv ?? house.levels[0]),
          room: roomId,
          camera: camera === 'perspective' ? 'persp' : 'iso',
          azimuth: azimuth ?? 315,
          time,
          date,
        });
        return { content: [{ type: 'image' as const, data: jpeg.toString('base64'), mimeType: 'image/jpeg' }] };
      } catch (e) {
        return fail(`Afbeelding maken lukte niet: ${(e as Error).message}`);
      }
    },
  );

  return server;
}
