# House designer — Waalstraat 16

Ons nieuwe huis in 3D inrichten: isometrisch (zoals de Sims) met een eigen meubelbibliotheek.
Later komen daar Claude-koppeling (MCP), rondlopen in 3D en varianten per ruimte bij — zie [docs/beslissingen.md](docs/beslissingen.md).

## Wat er nu kan (fase 1)

- **Het huis in 3D**, opgemeten uit de plattegronden van de brochure: begane grond (met uitbouw), eerste verdieping, zolder met schuin dak, tuin met overkapping, bergingen en carport. Zonder de meubels van de verkopers; vaste inbouw (keuken, badkamer, trap) staat er wel.
- **Weergave**: per verdieping of het hele huis met dak (“Buiten”). Muren hoog, weggesneden aan de camerakant (“Weg”) of allemaal laag. 90° draaien, kompas.
- **Bibliotheek**: meubels maken met sjablonen (bank, hoekbank, bed, tafel, kast, …) op exacte maten, of een **JSON-recept plakken** uit een Claude-gesprek. Status, prijs, winkel, link en notities per meubel. Totaal “nog te kopen”.
- **Inrichten**: plaatsen, slepen, draaien (R / Q / E), dupliceren, verwijderen. Meubels klikken **magnetisch tegen muren** en worden **rood als ze botsen** met een muur of ander meubel.
- **Samen**: elk een eigen account (beheer via de ronde knop rechtsboven → *Account*); wijzigingen van de ander verschijnen binnen een paar seconden.
- **Inloggen met passkey** (Face ID / Touch ID). Heb je een passkey, dan is die ook de tweede stap na je wachtwoord.
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

## Indelingen en rondlopen (fase 3)

- **Indelingen** (knop met de lagen rechtsboven): per kamer meerdere varianten, bijv. *Standaard* en *Bank bij het raam*. Kopiëren, leeg beginnen, hernoemen, verwijderen en met één tik wisselen. Meubels die je plaatst of verschuift horen bij de actieve variant van de kamer waar ze staan.
- **Afwerking per variant**: vloer (visgraat, laminaat, tegels, beton) en wanden: **verf** (palet of eigen kleur) of **behang** (streep, stip, ruit, botanisch, art-deco waaier, linnen, terrazzo — met eigen achtergrond- en motiefkleur, op ware grootte). Binnenmuren krijgen aan elke kant de afwerking van de kamer aan die kant.
- **Accentmuur**: tik in de bewerkmodus op een muur; in de muurbalk kies je verf of behang voor alleen die muur, *Hele kamer zo* of *Zoals de kamer*.
- **Prijs per variant**: wat er in die variant nog gekocht moet worden.
- **Rondlopen** (wandelaar-icoon): op ooghoogte door het huis. Laptop: klik in beeld, WASD/pijltjes, Shift = rennen, Esc = muis los. Telefoon/iPad: joystick linksonder, vegen = rondkijken. Je loopt niet door muren, vaste inbouw of meubels; wel door deuren (ook naar buiten). Wissel van verdieping met de knoppen bovenin.

## Claude koppelen (fase 2)

1. Ga in claude.ai naar **Instellingen → Connectors → Eigen connector toevoegen** en vul in: `https://huis.<jouwdomein>/mcp` (staat ook in de app onder *Account → Claude koppelen*).
2. Claude stuurt je naar de site: log in (wachtwoord of passkey) en klik **Toestaan**.
3. Vraag Claude bijvoorbeeld: *"Maak de IKEA Söderhamn 3-zits in grijs na en zet hem in de woonkamer tegen de muur met de sierhaard."*

Wat Claude kan (MCP-tools):

| Tool | Doet |
|---|---|
| `get_house` | plattegrond met maten, ramen/deuren per kamer, vaste inbouw, coördinatenstelsel |
| `list_furniture_library`, `get_furniture_item`, `list_templates` | bibliotheek en sjablonen bekijken |
| `create_furniture_item` | meubel maken uit een 3D-recept (met maatcontrole) |
| `create_furniture_from_template` | snel een standaardmeubel maken |
| `update_furniture_item`, `delete_furniture_item` | aanpassen of verwijderen |
| `place_furniture`, `move_furniture`, `remove_furniture`, `list_placed_furniture` | inrichten, met muursnap en botsingsmelding |
| `render_view` | afbeelding van een kamer/verdieping (iso of perspectief, met zonnestand) |
| `list_room_variants`, `create_room_variant`, `activate_room_variant` | varianten per kamer bekijken, maken (kopie) en wisselen |
| `set_room_finish` | vloer, verf of behang van een kamer, of van één muur per windrichting (accentmuur) |

Alle wijzigingen verschijnen direct in de app bij iedereen die hem open heeft (Server-Sent Events), met een melding wie wat deed. Koppelingen intrekken kan onder *Account → Claude koppelen*.

Techniek: OAuth 2.1 met dynamische clientregistratie en PKCE, tokens van 1 uur met roterende refresh tokens (90 dagen). `render_view` gebruikt de Chromium in de container (software-WebGL); een afbeelding duurt 20–40 seconden.

## Lokaal draaien

```bash
npm install
cp .env.example .env   # vul ADMIN_PASSWORD in; PUBLIC_URL=http://localhost:5173
npm run dev            # web op :5173, API op :8787
```

## Gebruikers

- Bij de **eerste start** (lege database) wordt één account aangemaakt uit `ADMIN_USERNAME` / `ADMIN_PASSWORD` (minstens 10 tekens), zoals bij iptv-blaster.
- Daarna log je daarmee in en maak je onder **Account → Gebruikers** extra accounts aan. Er zijn geen rollen: iedereen mag alles (ook gebruikers beheren of een wachtwoord resetten).
- Onder **Account → Passkeys** voeg je per apparaat een passkey toe. Passkeys werken alleen op het domein uit `PUBLIC_URL`.
- Noodtoegang vanaf de server (account aanmaken of wachtwoord resetten):

```bash
npm run user:add -- stefan Stefan "een-sterk-wachtwoord"
```

## Uitrollen met Dokploy (Hetzner) achter Cloudflare

1. Maak in Dokploy een **Application** van deze repository (build type: Dockerfile).
2. Voeg een **volume** toe: mount `/data` (hier staat de SQLite-database).
3. Environment:
   ```
   ADMIN_USERNAME=stefan
   ADMIN_DISPLAY_NAME=Stefan
   ADMIN_PASSWORD=<minstens 10 tekens>
   PUBLIC_URL=https://huis.<jouwdomein>
   ```
   Het account wordt alleen aangemaakt zolang de database nog leeg is; daarna kun je `ADMIN_PASSWORD` weghalen.
   `PUBLIC_URL` moet exact het adres zijn waarop je de site opent: passkeys en veilige cookies hangen ervan af.
4. Domein: bijv. `huis.<jouwdomein>` → container-poort **8787**, HTTPS aan.
5. In Cloudflare: DNS-record (A/CNAME) naar de Hetzner-server, proxy aan; SSL-modus *Full (strict)*.

Healthcheck: `GET /api/health`.

## Techniek

- `src/shared` — huismodel (`waalstraat16.ts`), meubelrecepten (`recipe.ts`, zod-schema), sjablonen, plaatsingslogica (snap/botsing).
- `src/client` — React + React Three Fiber; muren worden opgebouwd uit stukken rond ramen/deuren zodat ze laag gezet kunnen worden.
- `src/server` — Hono + ingebouwde SQLite van Node (`node:sqlite`); sessies met gehashte tokens in een httpOnly-cookie, scrypt-wachtwoorden, passkeys via SimpleWebAuthn, oplopende wachttijd na mislukte inlogpogingen.

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
