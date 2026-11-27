# SimNext

Een torenbouwspel voor in de browser. Je bouwt een lobby, zet er een lift in,
plaatst kantoren en appartementen en verdient huur. Houd de wachttijden bij de
lift kort, anders vertrekken je huurders.

Dit is de eerste speelbare versie. Het idee is om stap voor stap uit te breiden.

## Zo speel je

1. **Lobby** (toets 2): sleep over de begane grond. Alle mensen komen hier binnen.
2. **Lift** (toets 6): sleep vanaf de lobby omhoog. Begin op een bestaande lift om hem langer te maken.
3. **Verdieping** (toets 3): sleep over een verdieping om lege vloer te bouwen. Er moet altijd iets onder zitten.
4. **Kantoor** (toets 4) of **Appartement** (toets 5): klik op een plek naast de lift.
5. Een ruimte met een rood bordje is **te huur**. Is hij via de lift bereikbaar, dan komt er vanzelf een huurder.
6. Om middernacht krijg je **huur** binnen en betaal je **onderhoud** voor elke lift.
7. Het bolletje rechtsboven in een ruimte laat zien hoe **tevreden** de huurder is.
   Lang wachten op de lift maakt mensen ontevreden. Bij rood vertrekt de huurder.
   Een tweede lift helpt als je toren hoger wordt.
8. **Slopen** (toets 7): klik op een ruimte of lift. Je krijgt geen geld terug.

Overige bediening:

| Wat | Hoe |
| --- | --- |
| Rondkijken | rechtermuisknop slepen, pijltjestoetsen/WASD, of scrollen |
| Zoomen | Ctrl + scrollen, of `+` en `-` |
| Camera terugzetten | Home |
| Pauze | spatiebalk |
| Tijd sneller | knoppen 1×, 2×, 4× rechtsboven |
| Info over een ruimte | gereedschap Bekijken (toets 1) en met de muis eroverheen |

Kantoormedewerkers komen tussen 7:30 en 9:30 en gaan tussen 16:30 en 18:30 weer weg.
Bewoners van appartementen gaan 's ochtends de deur uit en komen 's avonds terug.
Dat zorgt voor drukte bij de lift in de ochtend en aan het eind van de middag.

## Spelen op je eigen computer

Je hebt [Node.js](https://nodejs.org) (versie 20 of nieuwer) nodig. Daarna in een terminal:

```bash
npm install
npm run dev
```

Open dan het adres dat in de terminal verschijnt (meestal http://localhost:5173).

## Online spelen (GitHub Pages)

Er staat een workflow klaar die het spel automatisch online zet bij elke wijziging op `main`.
Eenmalig instellen: ga in GitHub naar **Settings > Pages** en kies bij *Source* voor **GitHub Actions**.
Het spel staat daarna op `https://<gebruikersnaam>.github.io/simnext/`.

## Voor ontwikkelaars

- Vite + TypeScript + PixiJS 8.
- `npm test` draait de tests, `npm run build` maakt een productieversie in `dist/`.
- **Alle spelgetallen** (prijzen, huur, liftsnelheid, tijden, tevredenheid) staan in
  [`src/config/balance.ts`](src/config/balance.ts). Daar pas je de balans aan.
- `src/game/world.ts`: het raster, gebouwen en bouwregels.
- `src/game/sim.ts`: klok, huurders, mensen, liften en geld.
- `src/render/renderer.ts`: tekenen met PixiJS.
- `src/ui/`: knoppen, teksten (`strings.ts`, in het Nederlands) en muis/toetsenbord.
- In de browserconsole is `game.world` en `game.sim` beschikbaar om mee te experimenteren.
