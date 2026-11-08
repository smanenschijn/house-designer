# House designer — Waalstraat 16

Ons nieuwe huis in 3D inrichten: isometrisch (zoals de Sims) met een eigen meubelbibliotheek.
Later komen daar Claude-koppeling (MCP), rondlopen in 3D en varianten per ruimte bij — zie [docs/beslissingen.md](docs/beslissingen.md).

## Wat er nu kan (fase 1)

- **Het huis in 3D**, opgemeten uit de plattegronden van de brochure: begane grond (met uitbouw), eerste verdieping, zolder met schuin dak, tuin met overkapping, bergingen en carport. Zonder de meubels van de verkopers; vaste inbouw (keuken, badkamer, trap) staat er wel.
- **Weergave**: per verdieping of het hele huis met dak (“Buiten”). Muren hoog, weggesneden aan de camerakant (“Weg”) of allemaal laag. 90° draaien, kompas.
- **Bibliotheek**: meubels maken met sjablonen (bank, hoekbank, bed, tafel, kast, …) op exacte maten, of een **JSON-recept plakken** uit een Claude-gesprek. Status, prijs, winkel, link en notities per meubel. Totaal “nog te kopen”.
- **Inrichten**: plaatsen, slepen, draaien (R / Q / E), dupliceren, verwijderen. Meubels klikken **magnetisch tegen muren** en worden **rood als ze botsen** met een muur of ander meubel.
- **Samen**: elk een eigen login; wijzigingen van de ander verschijnen binnen een paar seconden.
- Werkt met muis en met touch (iPad/telefoon).

### Bediening

| | Laptop | Touch |
|---|---|---|
| Schuiven | slepen (linkermuis) | 1 vinger |
| Draaien | rechtermuis slepen of ⟲ ⟳ | 2 vingers draaien |
| Zoomen | scrollen | knijpen |
| Meubel verplaatsen | meubel slepen | meubel slepen |
| Draaien meubel | R (90°), Shift+R (−90°), Q/E (15°) | knoppen in de balk |
| Verfijnen | pijltjes (1 cm), Shift+pijltjes (10 cm) | — |
| Snap tijdelijk uit | Alt ingedrukt houden | 🧲-knop |

## Lokaal draaien

```bash
npm install
cp .env.example .env   # en vul eigen accounts in
npm run dev            # web op :5173, API op :8787
```

Accounts toevoegen of wachtwoord wijzigen:

```bash
npm run user:add -- stefan Stefan "een-sterk-wachtwoord"
```

## Uitrollen met Dokploy (Hetzner) achter Cloudflare

1. Maak in Dokploy een **Application** van deze repository (build type: Dockerfile).
2. Voeg een **volume** toe: mount `/data` (hier staat de SQLite-database).
3. Environment:
   ```
   BOOTSTRAP_USERS=stefan:Stefan:<wachtwoord>;partner:<Naam>:<wachtwoord>
   ```
   Accounts worden alleen aangemaakt als ze nog niet bestaan; daarna kun je de variabele weghalen.
4. Domein: bijv. `huis.<jouwdomein>` → container-poort **8787**, HTTPS aan.
5. In Cloudflare: DNS-record (A/CNAME) naar de Hetzner-server, proxy aan; SSL-modus *Full (strict)*.

Healthcheck: `GET /api/health`.

## Techniek

- `src/shared` — huismodel (`waalstraat16.ts`), meubelrecepten (`recipe.ts`, zod-schema), sjablonen, plaatsingslogica (snap/botsing).
- `src/client` — React + React Three Fiber; muren worden opgebouwd uit stukken rond ramen/deuren zodat ze laag gezet kunnen worden.
- `src/server` — Hono + ingebouwde SQLite van Node (`node:sqlite`), sessielogin met scrypt-wachtwoorden.

### Meubelrecept (voor Claude)

Maten in meters; oorsprong = midden van de onderkant; x = breedte, y = hoogte, z = diepte (voorkant = +z).

```json
{
  "version": 1,
  "size": { "width": 0.8, "depth": 0.4, "height": 0.75 },
  "materials": {
    "hout": { "color": "#b08a5e", "finish": "wood" },
    "zwart": { "color": "#1f1f1f", "finish": "metal" }
  },
  "parts": [
    { "shape": "box", "size": [0.8, 0.03, 0.4], "position": [0, 0.735, 0], "material": "hout", "radius": 0.005 },
    { "shape": "cylinder", "radius": 0.015, "height": 0.72, "position": [-0.37, 0.36, -0.17], "material": "zwart" }
  ]
}
```

Vormen: `box` (met optioneel `radius`), `cylinder` (`radius` of `radiusTop`/`radiusBottom`), `sphere` (met `scale` voor ellipsoïden), `torus`, `extrude` (2D-profiel + `depth`), `lathe` (draaiprofiel).
Afwerkingen: `matte`, `satin`, `gloss`, `metal`, `glass`, `fabric`, `velvet`, `leather`, `wood`, `stone`, `plastic`, `ceramic`, `plant`, `light`.

## Aannames in het huismodel

Plafond 2,60 m, verdiepingshoogte 2,80 m, binnendeuren 83 × 211,5 cm, dakhelling ca. 34° (afgeleid uit de 1,50 m-lijn op de zolderplattegrond), vensterbanken geschat uit foto's, ligging van overkapping en tuinberging indicatief. Aanpassen kan in `src/shared/waalstraat16.ts`.
