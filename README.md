# SimNext

Een torenbouwspel voor in de browser. Bouw een lobby, liften en trappen, vul je toren met
kantoren, appartementen, winkels, restaurants en hotelkamers, en laat hem groeien van
nieuwbouw (★) tot wereldtoren (★★★★★). Houd de wachttijden bij de lift kort, anders
vertrekken je huurders.

## Zo speel je

1. **🚪 Lobby** (toets 2): sleep over de begane grond. Iedereen komt hier binnen.
2. **🛗 Lift** (toets 5): sleep vanaf de lobby omhoog. Begin op een bestaande lift om hem langer te maken.
3. **🧱 Verdieping** (toets 3): sleep om lege vloer te bouwen. Er moet altijd iets onder zitten.
4. **🪜 Trap** (toets 4): klik om een trap naar de verdieping erboven te zetten. Goedkoop en handig voor korte stukjes.
5. **💼 Kantoor** (6) en **🏠 Appartement** (7): een nieuwe huurder betaalt meteen een borg (twee dagen huur), daarna elke nacht huur. Hoe hoger, hoe meer huur. Een rood bordje betekent *te huur*. Naast je geld zie je wat er vannacht netto binnenkomt.
6. Meer mensen leveren **sterren** op, en die spelen nieuwe dingen vrij:

   | Sterren | Mensen | Vrijgespeeld |
   | --- | --- | --- |
   | ★★ | 80 | 🛍️ Winkel (8), 🍽️ Restaurant (9), ook in de lobby en kelder |
   | ★★★ | 250 | 🛏️ Hotelkamer (0), 🚇 Metrostation (M) |
   | ★★★★ | 600 | ⚡ Expreslift (E): sneller en groter |
   | ★★★★★ | 1200 | Wereldtoren! |

7. **Winkels en restaurants** trekken bezoekers van buiten en verdienen per klant. Kantoormensen gaan lunchen, bewoners gaan 's avonds uit eten.
8. **Hotelgasten** checken 's avonds in (dan betalen ze) en vertrekken 's ochtends.
9. Het **lampje** rechtsboven in een ruimte toont de tevredenheid. Lang wachten op de lift kost punten. Bij rood vertrekt de huurder.
10. Mensen kiezen zelf de snelste route en stappen over tussen liften en trappen.
11. **Kelders**: bouw met 🧱 Verdieping onder de lobby (tot 6 diep). Liften kunnen ook omlaag. Winkels en restaurants mogen in de kelder.
12. **🚇 Metrostation** (M, alleen in de kelder): elke paar minuten stopt er een trein met bezoekers, en het station is een extra ingang van je toren.
13. **Gebeurtenissen** (vanaf dag 2):
    - **VIP-bezoek**: een belangrijke gast reist naar je hoogste winkel of restaurant. Gaat dat snel, dan krijg je een beloning.
    - **Zakenbeurs**: een dag lang veel meer bezoekers.
    - **Stroomstoring**: een uur lang staan alle liften stil.
    - **Brand**: **klik op het vuur** om de brandweer te bellen. Wacht je te lang, dan slaat het over en brandt de ruimte af.
14. **🧨 Slopen** (X): klik op een ruimte, lift of trap. Je krijgt geen geld terug.

**Geluid**: het spel maakt zijn eigen muziek en geluidjes (zelf gegenereerd, geen opnames).
Zet ze aan of uit via het menu (☰).

Het spel wordt automatisch opgeslagen in je browser. Via het menu (☰) kun je ook zelf
opslaan of een nieuw spel beginnen.

| Wat | Hoe |
| --- | --- |
| Rondkijken | rechtermuisknop slepen, pijltjestoetsen/WASD, of scrollen |
| Zoomen | Ctrl + scrollen, of `+` en `-` |
| Camera terugzetten | Home |
| Pauze | spatiebalk |
| Tijd sneller | knoppen ▶, ▶▶, ▶▶▶ rechtsboven |
| Info over een ruimte | 🔍 Bekijken (toets 1) en met de muis eroverheen |

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
- `src/game/routing.ts`: routes zoeken over liften en trappen.
- `src/game/sim.ts`: klok, huurders, bezoekers, gasten, liften, sterren en geld.
- `src/game/save.ts`: opslaan en laden.
- `src/render/`: tekenen met PixiJS (`backdrop.ts` lucht en stad, `building.ts` gebouw en interieurs, `actors.ts` mensen, liften en verkeer).
- `src/ui/`: knoppen, teksten (`strings.ts`, in het Nederlands) en muis/toetsenbord.
- In de browserconsole is `game.world` en `game.sim` beschikbaar om mee te experimenteren.
