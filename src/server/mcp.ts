import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkRecipe, describeHouse, findCollisions, findRoom, roomCenter, roomOf } from '../shared/analysis';
import { clearance, clearanceWarnings } from '../shared/clearance';
import { bottomOf, findSupport, isOnTop, isResting, placementY } from '../shared/stacking';
import { snapToWalls } from '../shared/placement';
import { CATEGORIES, FINISHES, RecipeSchema, STATUSES, type Item, type Recipe } from '../shared/recipe';
import { TEMPLATES, TEMPLATE_MAP, buildFromTemplate } from '../shared/templates';
import { waalstraat16 as house } from '../shared/waalstraat16';
import type { PublicUser } from './auth';
import {
  createItem,
  createPlacement,
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
import { BlenderError, blenderPath, runBlender } from './blender';
import { ModelError, UPLOAD_TTL_MS, clearModel, createUploadTicket, deleteItemWithModel, saveModel } from './models';
import { origin } from './config';

const INSTRUCTIONS = `Dit is de inrichtingsapp voor Waalstraat 16 in Nijverdal (twee-onder-een-kap, begane grond, eerste verdieping, zolder).
Gebruik get_house voor de plattegrond met maten. Meubels maak je als "recept": eenvoudige 3D-vormen op exacte maten (zie create_furniture_item).
Gebruik altijd de echte maten van het product (breedte × diepte × hoogte); zoek die op als de gebruiker een link of productnaam geeft.
Plaats meubels met place_furniture en controleer met render_view hoe het eruitziet.
Voor mooiere, gedetailleerde meubels gebruik je Blender: create_furniture_with_blender (Blender op de server, werkt overal) of, als je zelf Blender-tools hebt, prepare_model_upload (model in de eigen Blender van de gebruiker bouwen en uploaden). Bekijk het resultaat met preview_furniture_item en verbeter tot het klopt met de productfoto's.
Elke kamer kan meerdere varianten hebben (list_room_variants). Wil de gebruiker een alternatief proberen, maak dan eerst een variant (create_room_variant) zodat de huidige opstelling bewaard blijft. Vloer en wandkleur stel je in met set_room_finish.
Antwoord de gebruiker in het Nederlands.`;

const RECIPE_GUIDE = `Recept (JSON), alles in meters:
- size: { width (x), depth (z), height (y) } = buitenmaten van het meubel.
- Oorsprong = midden van de ONDERKANT. x van -width/2 tot +width/2, z van -depth/2 tot +depth/2, y van 0 tot height. De VOORKANT (zitkant, deuren) wijst naar +z.
- materials: { naam: { color: "#rrggbb", finish } }, finish ∈ ${FINISHES.join(', ')}. Optioneel opacity (0–1). Gebruik finish "light" voor lampenkappen/lichtbronnen: die geven ’s avonds echt licht (render_view met time na zonsondergang, bijv. "22:00").
- parts: lijst onderdelen met position = MIDDEN van het onderdeel [x,y,z], optioneel rotation [rx,ry,rz] in graden, en material (naam uit materials):
  • box: size [x,y,z], optioneel radius (afronding, bv. 0.03 voor kussens)
  • cylinder: radius (of radiusTop/radiusBottom), height (langs y)
  • sphere: radius, optioneel scale [sx,sy,sz] (ellipsoïde; radius 0.5 + scale = maten)
  • torus: radius, tube, optioneel arc (graden)
  • extrude: points [[x,y],...] profiel in XY, depth langs z (gecentreerd)
  • lathe: points [[straal,y],...] gedraaid rond de y-as
- Tip: bouw herkenbaar maar eenvoudig (10–40 onderdelen): frame, kussens, poten, grepen, naden. Houd alle onderdelen binnen size.`;

const BLENDER_GUIDE = `Blender-richtlijnen (bpy, Blender 3.4+):
- Eenheden in meters. Z is omhoog. De VOORKANT van het meubel wijst naar -Y (Blender "Front"-aanzicht); breedte langs X, diepte langs Y.
- Zet het meubel op de grond (onderkant op z = 0), gecentreerd rond x = 0, y = 0. Exacte buitenmaten van het product aanhouden.
- Begin met een lege scène (die krijg je al); maak alleen de objecten van het meubel (geen camera's, lampen of vloer).
- Materialen: Principled BSDF met Base Color, Roughness, Metallic (en eventueel Transmission voor glas). Procedurele texturen exporteren NIET naar GLB; gebruik kleuren, of bak ze eerst naar een afbeelding.
- Maak het realistisch: afgeronde randen (Bevel-modifier, 2–3 segmenten, 3–10 mm), kussens met Subdivision Surface, naden en zachte vormen, echte poten en grepen. Modifiers worden bij export toegepast.
- Houd het licht: richtwaarde < 60.000 driehoeken; gebruik 'Shade Smooth' + Auto Smooth (mesh.use_auto_smooth = True) in plaats van extra geometrie.
- Gebruik bpy.data/bmesh of bpy.ops; selecteer/activeer objecten expliciet voordat je operators gebruikt.`;

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
    model: it.model ? `${it.model.source === 'blender' ? 'Blender' : 'upload'}, ${it.model.triangles} driehoeken` : 'recept',
  };
}

function placementInfo(pid: string) {
  const p = getPlacement(pid);
  if (!p) return null;
  const it = getItem(p.itemId);
  const level = house.levels.find((l) => l.id === p.levelId)!;
  const room = roomOf(level, p.x, p.z);
  const all = listItems();
  const collisions = findCollisions(house, p.levelId, visible(), all).get(p.id) ?? [];
  const cl = clearance(house, p, visible(), all);
  const warnings = clearanceWarnings(cl);
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
    height_above_floor_cm: Math.round((p.y ?? 0) * 100),
    standing_on: (() => {
      if (!it) return 'vloer';
      const s = findSupport(level, p, it, p.id, visible(), all, bottomOf(p, it));
      if (s.on && Math.abs(s.y - bottomOf(p, it)) < 0.02) return s.on;
      return bottomOf(p, it) < 0.005 ? 'vloer' : 'zwevend (eigen hoogte)';
    })(),
    variant: variant ? `${variant.name}${isPlacementVisible(p.variantId, listVariants(), activeMap()) ? '' : ' (niet actief)'}` : 'buiten',
    collisions: collisions.length ? collisions : 'geen',
    // vrije ruimte per zijkant (voor/achter/links/rechts van het meubel zelf) en waarschuwingen
    free_space_cm: Object.fromEntries(cl.gaps.map((g) => [g.side, `${Math.round(g.dist * 100)} tot ${g.obstacle}`])),
    warnings: warnings.length ? warnings : 'geen',
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
      description: 'Volledige gegevens van één meubel, inclusief het 3D-recept, en bij een Blender-model ook het script (model.script) waarmee het gemaakt is, zodat je het kunt verbeteren.',
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
      description: 'Past naam, recept of gegevens (status, prijs, winkel, link, notities) van een meubel aan. Geplaatste exemplaren veranderen mee. Let op: een nieuw recept vervangt een eventueel 3D-model (Blender/upload); voor een beter model gebruik je create_furniture_with_blender met item_id.',
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
      if (recipe && cur.model) clearModel(item_id);
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
      deleteItemWithModel(item_id);
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
        'Met snap_to_wall (standaard aan) schuift het meubel strak tegen een muur als het daar binnen 25 cm van staat. Je krijgt botsingen terug, de vrije ruimte per zijkant en waarschuwingen (voor een deur, doorgang < 60 cm; advies ≥ 70 cm). ' +
        'Hoogte gaat automatisch: kleine dingen (plant, lamp, decoratie, apparaat) die helemaal op een tafel, kast of vaste inbouw passen, komen daarop te staan; anders op de vloer. Banken, stoelen, bedden, tafels en vloerkleden staan altijd op de vloer. Met height_m zet je zelf een hoogte (bijv. iets aan de muur).',
      inputSchema: {
        item_id: z.string(),
        room: z.string().optional().describe('kamernaam of id, bijv. "woonkamer"'),
        level: z.string().optional().describe('bg, 1e of zolder (nodig bij x/z zonder kamer)'),
        x: z.number().optional(),
        z: z.number().optional(),
        rotation: z.number().optional(),
        snap_to_wall: z.boolean().optional(),
        height_m: z.number().min(0).max(3).optional().describe('hoogte boven de vloer; leeg = automatisch (op tafel/kast als het past)'),
      },
    },
    async ({ item_id, room, level, x, z: zz, rotation, snap_to_wall, height_m }) => {
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
      const y = height_m ?? placementY(it, findSupport(lv, { x: px, z: pz, rotation: rot }, it, null, visible(), listItems()));
      actor(`“${it.name}” geplaatst`);
      const p = createPlacement({ itemId: it.id, levelId: lv.id, x: px, z: pz, rotation: rot, y }, user.id);
      return json(placementInfo(p.id));
    },
  );

  server.registerTool(
    'move_furniture',
    {
      title: 'Meubel verplaatsen/draaien',
      description:
        'Verplaatst of draait een geplaatst meubel (placement_id uit list_placed_furniture of place_furniture). Alleen opgegeven velden veranderen. ' +
        'Stond het op de vloer of op iets, dan komt het automatisch op wat er op de nieuwe plek onder staat. Wat erop staat (plant op de tafel) verhuist mee. height_m zet een eigen hoogte.',
      inputSchema: {
        placement_id: z.string(),
        x: z.number().optional(),
        z: z.number().optional(),
        rotation: z.number().optional(),
        level: z.string().optional(),
        snap_to_wall: z.boolean().optional(),
        height_m: z.number().min(0).max(3).optional().describe('hoogte boven de vloer; leeg = automatisch'),
      },
    },
    async ({ placement_id, x, z: zz, rotation, level, snap_to_wall, height_m }) => {
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
      const all = listItems();
      const vis = visible();
      const oldLevel = house.levels.find((l) => l.id === p.levelId)!;
      // wat erop staat verhuist mee (zelfde verschuiving)
      const riders = vis.filter((q) => {
        const qi = all.find((i) => i.id === q.itemId);
        return !!qi && isOnTop(q, qi, p, it);
      });
      const others = vis.filter((q) => !riders.some((r) => r.id === q.id));
      const y =
        height_m ??
        (isResting(oldLevel, p, it, vis, all) ? placementY(it, findSupport(lv, { x: nx, z: nz, rotation: rot }, it, p.id, others, all, bottomOf(p, it))) : (p.y ?? 0));
      actor(`“${it.name}” verplaatst`);
      updatePlacement(placement_id, { x: nx, z: nz, rotation: rot, levelId: lv.id, y });
      for (const r of riders) updatePlacement(r.id, { x: r.x + (nx - p.x), z: r.z + (nz - p.z), y: (r.y ?? 0) + (y - (p.y ?? 0)), levelId: lv.id });
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

  // ---------- Blender en 3D-modellen ----------
  const previewImage = async (itemId: string, azimuth = 330, elevation = 22) => {
    const jpeg = await renderView(user, { item: itemId, elevation, level: 0, camera: 'persp', azimuth });
    return { type: 'image' as const, data: jpeg.toString('base64'), mimeType: 'image/jpeg' };
  };

  server.registerTool(
    'create_furniture_with_blender',
    {
      title: 'Meubel maken met Blender',
      description:
        `Bouwt een gedetailleerd 3D-meubel met een Blender-script (Python/bpy) dat op de server in headless Blender draait. Het resultaat (GLB) komt in de bibliotheek en je krijgt een voorvertoning terug zoals het in de app staat.\n` +
        `Met item_id vervang je het model van een bestaand meubel (plaatsingen blijven staan); zonder item_id komt er een nieuw meubel. Bij een fout krijg je de Python-traceback terug: verbeter het script en probeer opnieuw.\n\n${BLENDER_GUIDE}`,
      inputSchema: {
        script: z.string().min(10).describe('volledig bpy-script dat het meubel opbouwt'),
        name: z.string().optional().describe('verplicht voor een nieuw meubel'),
        category: z.enum(CATEGORIES).optional(),
        item_id: z.string().optional().describe('bestaand meubel waarvan het model vervangen wordt'),
        ...metaShape,
      },
    },
    async ({ script, name, category, item_id, status, price, shop, url, notes }) => {
      if (!blenderPath()) return fail('Blender is niet beschikbaar op deze server. Gebruik prepare_model_upload met de eigen Blender van de gebruiker, of create_furniture_item.');
      if (!item_id && !name) return fail('Geef een name voor het nieuwe meubel (of item_id om een bestaand meubel te vervangen).');
      if (item_id && !getItem(item_id)) return fail('Meubel niet gevonden.');
      let glb: Buffer;
      try {
        ({ glb } = await runBlender(script));
      } catch (e) {
        if (e instanceof BlenderError) return fail(`${e.message}\n\n${e.log}`);
        throw e;
      }
      try {
        const meta = Object.fromEntries(Object.entries({ status, price, shop, url, notes }).filter(([, v]) => v !== undefined));
        actor(`meubel “${name ?? getItem(item_id!)?.name}” gemaakt in Blender`);
        const it = saveModel(glb, { itemId: item_id, name, category, meta, source: 'blender', script, scale: 1, rotation: 0 }, user.id);
        if (item_id && (name || category || Object.keys(meta).length)) updateItem(item_id, { ...(name ? { name } : {}), ...(category ? { category } : {}), meta: { ...it.meta, ...meta } });
        const info = { item_id: it.id, name: it.name, size_cm: fmtCm(it.recipe), triangles: it.model!.triangles, kb: Math.round(it.model!.bytes / 1024) };
        try {
          return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }, await previewImage(it.id)] };
        } catch (e) {
          return json({ ...info, preview: `voorvertoning mislukt: ${(e as Error).message}` });
        }
      } catch (e) {
        if (e instanceof ModelError) return fail(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    'prepare_model_upload',
    {
      title: 'Uploadlink voor een 3D-model',
      description:
        'Geeft een eenmalige uploadlink (30 minuten geldig) voor een GLB-bestand. Bedoeld voor wanneer je een model bouwt in de eigen Blender van de gebruiker (bijv. via Blender-MCP-tools): exporteer daar als GLB en upload met het meegeleverde Python-fragment rechtstreeks vanuit Blender. ' +
        'Zo hoeft het bestand niet door het gesprek. Met item_id vervang je het model van een bestaand meubel.\n\n' + BLENDER_GUIDE,
      inputSchema: {
        name: z.string().optional().describe('verplicht voor een nieuw meubel'),
        category: z.enum(CATEGORIES).optional(),
        item_id: z.string().optional(),
        ...metaShape,
      },
    },
    async ({ name, category, item_id, status, price, shop, url, notes }) => {
      if (!item_id && !name) return fail('Geef een name voor het nieuwe meubel (of item_id om een bestaand meubel te vervangen).');
      if (item_id && !getItem(item_id)) return fail('Meubel niet gevonden.');
      const meta = Object.fromEntries(Object.entries({ status, price, shop, url, notes }).filter(([, v]) => v !== undefined));
      const token = createUploadTicket(user.id, { itemId: item_id, name, category, meta });
      const uploadUrl = `${origin}/api/upload/${token}`;
      const python = [
        'import bpy, os, tempfile, urllib.request, json',
        "path = os.path.join(tempfile.gettempdir(), 'meubel.glb')",
        "bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=False, export_cameras=False, export_lights=False)",
        `req = urllib.request.Request(${JSON.stringify(uploadUrl)}, data=open(path, 'rb').read(), method='POST', headers={'Content-Type': 'model/gltf-binary'})`,
        'print(json.loads(urllib.request.urlopen(req, timeout=60).read()))',
      ].join('\n');
      return json({
        upload_url: uploadUrl,
        expires_in_minutes: UPLOAD_TTL_MS / 60_000,
        method: 'POST met het GLB-bestand als body (Content-Type: model/gltf-binary)',
        blender_python: python,
        curl: `curl -X POST --data-binary @meubel.glb -H 'Content-Type: model/gltf-binary' ${uploadUrl}`,
        next: 'Na de upload: preview_furniture_item met het teruggegeven item_id om het resultaat te controleren.',
      });
    },
  );

  server.registerTool(
    'preview_furniture_item',
    {
      title: 'Voorvertoning van een meubel',
      description: 'Afbeelding van één meubel uit de bibliotheek, los en op ware grootte met een maatraster van 10 cm, zoals het in de app getekend wordt. Gebruik dit om een model te vergelijken met de productfoto en te verbeteren. azimuth: 0 = recht van voren, 90 = rechterzijkant, 180 = achterkant.',
      inputSchema: {
        item_id: z.string(),
        azimuth: z.number().optional().describe('standaard 330 (schuin links-voor)'),
        elevation: z.number().min(-10).max(90).optional().describe('kijkhoogte in graden, standaard 22'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ item_id, azimuth, elevation }) => {
      const it = getItem(item_id);
      if (!it) return fail('Meubel niet gevonden.');
      try {
        return { content: [{ type: 'text' as const, text: `${it.name} — ${fmtCm(it.recipe)}${it.model ? `, ${it.model.triangles} driehoeken` : ' (recept)'}` }, await previewImage(it.id, azimuth, elevation)] };
      } catch (e) {
        return fail(`Voorvertoning mislukt: ${(e as Error).message}`);
      }
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
