# Beslissingen

Antwoorden uit de vragenronde, als basis voor het ontwerp.

## Huis

- **Bron van de maten:** de plattegronden uit de brochure (Velding.nl). Er wordt niet opgemeten of gescand vóór de verhuizing.
- **Ontbrekende maten:** standaardmaten aanhouden (aannames, later aan te passen):
  - plafondhoogte begane grond en 1e verdieping: 2,60 m
  - binnendeuren: 83 × 211,5 cm, voordeur 93 × 231,5 cm
  - binnenmuren 10 cm, dragende/woningscheidende muren 20–30 cm (waar de tekening dat laat zien)
  - vensterbanken ca. 90 cm boven de vloer (slaapkamers), lager bij de grote ramen beneden

## Claude-koppeling

- **Gebruik:** vooral vanuit claude.ai (web en telefoonapp), ook onderweg in de winkel.
- **Gevolg:** de MCP-server moet publiek bereikbaar zijn als *remote MCP* (HTTPS, Streamable HTTP) met authenticatie (OAuth), zodat hij als custom connector in claude.ai kan worden toegevoegd.

## Hosting

- **App + MCP-server:** als Docker-container(s) op de eigen Hetzner-server, uitgerold via Dokploy.
- **Cloudflare:** DNS en proxy voor het eigen domein (subdomein voor dit project); eventueel R2 later voor opslag van modellen.
- **Waarom niet volledig Cloudflare Workers:** op een eigen server kunnen we zware hulpmiddelen draaien die in Workers niet passen: glTF-verwerking/optimalisatie, headless browser voor schermafbeeldingen van de scène (zodat Claude kan meekijken) en eventueel headless Blender.
- **Opslag:** modellen (GLB) en foto's op een persistent volume; database (SQLite of Postgres) voor bibliotheek, huismodel en indelingen.

## Meubelmodellen

- **Stijl:** strak en op maat (geen fotorealisme). Juiste maten, kleuren en materialen zijn belangrijker dan details.
- **Aanpak (fase 1):** Claude levert via de MCP een declaratief *recept* (JSON): onderdelen als afgeronde blokken, cilinders, geëxtrudeerde profielen en gedraaide vormen, elk met maten, positie en materiaal. De site bouwt daar live het model van in Three.js.
  - Voordelen: maten altijd exact, parameters later aan te passen (bank 20 cm breder = één getal), varianten (kleur/maat) gratis, geen code-executie op de server, werkt direct vanaf de telefoon.
- **Blender (later, optioneel):** headless Blender op de server als tweede pipeline voor vormen die het recept niet aankan, en om realistische/externe modellen op te schonen en te schalen. Niet als standaard, vanwege: willekeurige Python uitvoeren op de server (sandbox nodig), trager, foutgevoeliger, procedurele materialen moeten gebaked worden voor glTF, en het resultaat is niet meer parametrisch aan te passen.
- **Later optioneel:** foto-naar-3D-dienst (Meshy/Tripo) voor realistische modellen.

## Apparaten

- **Laptop/desktop én iPad/telefoon** zijn volwaardige doelen; touch vanaf dag één meenemen.
- Desktop: WASD + muis (pointer lock) voor rondlopen; slepen/draaien met muis, sneltoetsen.
- Touch: virtuele joystick (lopen) + vegen (kijken) in rondloopmodus; in isometrische modus één vinger slepen = meubel verplaatsen, twee vingers = pannen/zoomen/draaien; draaiknop/handvat op het geselecteerde meubel.
- Responsive UI: bibliotheek als zijpaneel op desktop, als uitschuifpaneel van onderen op telefoon.
- Prestatie: modellen licht houden (recepten zijn van nature licht), schaduwen/kwaliteit afschalen op mobiel.

## Gebruikers en samenwerken

- **Gebruikers:** de gebruiker en partner (huishouden), elk met een eigen login.
- **Live samenwerken:** wijzigingen (meubel plaatsen/draaien/verwijderen, nieuwe items in de bibliotheek, ook die via Claude/MCP binnenkomen) verschijnen direct bij de ander, via WebSocket.
- **Wie-deed-wat:** per item/plaatsing bijhouden wie het toevoegde; aanwezigheid tonen (wie is online, eventueel waar in het huis).
- **Conflicten:** laatste wijziging wint per object; tegelijk hetzelfde meubel slepen wordt zichtbaar gemaakt (vergrendeling tijdens slepen).
- **Login:** dezelfde accounts voor de site en de MCP-koppeling (OAuth), zodat Claude-wijzigingen op naam van de juiste persoon komen.

## Bibliotheek

- **Inhoud:** nieuwe meubels die ze tegenkomen én eigen meubels die meeverhuizen; zij bepalen zelf wat erin komt.
- **Toevoegen eigen meubels:** zelf fotograferen + maten opmeten, en via Claude (foto + maten) laten omzetten naar een recept. Handmatig toevoegen/aanpassen op de site moet ook kunnen (maten, kleur, naam).
- **Status per meubel:** "hebben we al" / "overwegen" / "favoriet" / "gekocht" / "afgevallen".
- **Metadata:** naam, categorie, maten (B×D×H), kleur/materiaal, foto('s), winkel, link, prijs, notities, toegevoegd door.
- **Filteren** op status, categorie en ruimte; totaalprijs van wat in een indeling staat.

## Indelingen en varianten

- **Meerdere varianten** naast elkaar bewaren, **per ruimte** (bijv. "Woonkamer – hoekbank" vs. "Woonkamer – twee banken").
- Een **totaalindeling** van het huis = per ruimte een gekozen variant; zo combineer je varianten vrij.
- Variant dupliceren als startpunt, hernoemen, verwijderen; met één klik wisselen.
- Vergelijken: snel schakelen tussen varianten met dezelfde camerapositie; totaalprijs per variant.
- Een meubel uit de bibliotheek kan in meerdere varianten staan (plaatsing verwijst naar het bibliotheekitem; maat/kleur wijzigen werkt overal door).
- Claude kan via de MCP een variant aanmaken/aanpassen ("maak een variant van de woonkamer met de groene bank").

## Huis aanpassen

- **Geometrie ligt vast:** muren, deuren, ramen en trappen komen uit de plattegrond en zijn in de app niet te bewerken (wel via code/MCP te corrigeren als een maat niet klopt).
- **Wel aanpasbaar:** wandkleur/behang per wand en vloer per ruimte (bijv. visgraat, laminaat, tegels, tapijt), als onderdeel van de variant van die ruimte.
- Vaste inbouw (keuken, badkamer, inloopkast, trap) hoort bij het huis, niet bij de meubels.
- Blijven achter en staan daarom vast in het huis: zwevend tv-meubel (voorgevel), zwevende lowboard met elektrische sierhaard en schouw (rechterwand woonkamer) en de Amerikaanse koelkast (tegen de halmuur in de keuken). Maten deels geschat uit de foto’s.
- Vaste inbouw telt mee bij de botsingscontrole van meubels.

## Planning

Verhuizing binnen 2 maanden (vanaf 2026-11-08, dus vóór begin januari 2027). Zo snel mogelijk iets bruikbaars om mee te winkelen; daarna uitbreiden.

**Fase 1 – Bruikbaar huis + bibliotheek**
- Huismodel (JSON) uit de plattegronden: BG, 1e, zolder (met schuin dak), tuin/overkapping/berging/carport eenvoudig.
- Isometrische weergave met wegvallende muren en verdiepingkeuze.
- Recept-renderer voor meubels; bibliotheek; plaatsen/draaien/verwijderen (muis én touch), magnetisch tegen muren.
- Login voor twee gebruikers; deploy op Dokploy achter Cloudflare.

**Fase 2 – Claude-koppeling**
- Remote MCP-server (OAuth) met tools: meubel uit recept toevoegen/aanpassen, bibliotheek doorzoeken, plaatsen, schermafbeelding van een ruimte.
- Live synchronisatie tussen apparaten (WebSocket).

**Fase 3 – Comfort**
- Rondloopmodus (desktop + touch), varianten per ruimte, wandkleur/vloer, totaalprijs, status/filters.

**Later**
- Headless Blender, foto-naar-3D, zonlicht/oriëntatie, meten in de app.

## Techniek (voorstel)

- TypeScript-monorepo.
- Frontend: Vite + React + React Three Fiber + drei.
- Backend: Node (Hono) + SQLite (Drizzle) + WebSocket; bestanden op een persistent volume.
- MCP: officiële TypeScript SDK, Streamable HTTP, OAuth.
- Eén Docker-image, uitgerold via Dokploy.
