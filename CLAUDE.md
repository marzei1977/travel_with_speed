# Linke Spur (Autobahn-Routenplaner)

Statische Webseite (GitHub Pages), die Routen nach **echten Tempolimits** statt nach
Durchschnittstempo bewertet. Zielgruppe ist ein Fahrer, der unbegrenzte Abschnitte
ausnutzt (gemessen: Ø 147 km/h, Spitzenviertel ab 171): für ihn kann eine längere,
überwiegend unbegrenzte Route schneller sein als die kürzeste.

Live: https://marzei1977.github.io/travel_with_speed/routenplaner/

## Wichtigste Regel: die Datendateien niemals einlesen

| Datei | Größe | entspricht |
|---|---|---|
| `routenplaner/data/routes.json` | 4,1 MB | **~1.058.000 Token** |
| `routenplaner/data/roadworks.json` | 1,2 MB | ~300.000 Token |
| `routenplaner/data/speedgrid.json` | 311 KB | ~80.000 Token |
| `routenplaner/data/traffic.json` | 294 KB | ~75.000 Token |

Ein `Read` darauf sprengt den Kontext. Stattdessen gezielt abfragen:

```bash
node -e 'const d=require("./routenplaner/data/routes.json");
console.log(d.corridors.map(c=>c.id+": "+c.routes.length+" Routen").join("\n"))'
```

Für Inhaltsfragen gibt es fertige Werkzeuge (siehe unten) – die sind fast immer
die bessere Antwort als eigene Abfragen.

## Aufbau

- `routenplaner/index.html` – die ganze Anwendung, Berechnung läuft im Browser
- `routenplaner/fahrt/index.html` – Auswertung hochgeladener GPX-Aufzeichnungen;
  nimmt über `?aufzeichnung=<id>` auch eine selbst aufgezeichnete Fahrt aus
  IndexedDB entgegen
- `routenplaner/aufzeichnen/index.html` – eigener GPS-Tracker. Punkte liegen in
  IndexedDB (`linke-spur`, Stores `fahrten` und `bloecke`), minütlich in Blöcken
  geschrieben. **Web-Apps bekommen keinen Standort im Hintergrund** – deshalb
  Wake Lock und der Hinweis, den Bildschirm anzulassen
- `routenplaner/sw.js` + `manifest.webmanifest` – installierbare Web-App (PWA).
  **Beim Ändern von `sw.js` die `VERSION` hochzählen**, sonst behalten bestehende
  Installationen ihren alten Cache. Alles, was die Seiten laden, muss entweder in
  `SHELL` stehen oder unter `data/*.json` liegen – `config/corridors.json` lag
  einmal in keiner der beiden Listen und fehlte offline
- `routenplaner/vendor/leaflet/` – Leaflet lokal statt vom CDN, sonst startet die
  Karte offline nicht
- `routenplaner/config/corridors.json` – hinterlegte Strecken und ihre Wegpunkte
- `routenplaner/scripts/*.mjs` – Datenbeschaffung, laufen per GitHub Actions
- `routenplaner/README.md` – **Modellannahmen und Grenzen ausführlich**; bei
  inhaltlichen Fragen zuerst dort nachsehen (~3.500 Token, lohnt sich)

Fünf Cronjobs halten die Daten aktuell: Baustellen alle 30 Min, Tempolimits und
Raster wöchentlich, Verkehrsdaten und Kreuze monatlich.

## Werkzeuge zum Prüfen

```bash
# Eine Strecke kilometerweise: Limit, Baustelle, gerechnetes Tempo
node routenplaner/scripts/audit-route.mjs koeln-muenchen 150 0 2026-08-11T08:00 --html /tmp/a.html

# Lokale Vorschau (die Seite lädt data/*.json per fetch und braucht daher HTTP)
node routenplaner/scripts/dev-server.mjs   # -> http://localhost:8731/routenplaner/

# Aufgezeichnete Fahrt gegen die Limits halten (--pause trennt Fahrt von Halt)
node routenplaner/scripts/vergleich-fahrt.mjs fahrt.gpx --csv /tmp/v.csv [--pause 180]
```

## Fehler, die schon einmal gemacht wurden

Diese Fallen sind behoben. Sie beim Ändern nicht wieder aufreißen:

- **Wegpunkte müssen exakt auf der Fahrbahn liegen.** 850 m daneben genügen, damit
  der Router die Autobahn verlässt und durch Ortschaften fährt. Das hatte einmal
  40 Minuten Fehler erzeugt und die Rangfolge gedreht.
- **Wegpunkte nicht ins Autobahnkreuz legen, sondern einige Kilometer dahinter auf
  die Zielfahrbahn.** Im Kreuz snappt OSRM auf eine Rampe, fährt am Kreuz vorbei,
  wendet und kommt zurück – 8 bis 32 km Umweg je Punkt, ohne Fehlermeldung. Weil
  die Richtungsfahrbahnen getrennte OSM-Wege sind, gilt ein solcher Punkt nur für
  **eine** Fahrtrichtung; daher die Namen `biebelried-a7sued`, `hattenbach-a7nord`
  usw. Betraf einmal alle zwölf Routen (bis zu 70 km zu lang).
- **Die freie Suche hat eigene Wegpunkte (`junctions.json`) – dieselbe Falle.**
  `motorway_junction` steht auch an Bundesstraßen, der Namensfilter kannte keine
  Wortgrenzen; 31 von 336 Einträgen waren falsch ("Aalener Dreieck" schickte
  Routen durch Aalen). `fetch-junctions.mjs` filtert jetzt nach Wortgrenze und
  Abstand zur Autobahn (`speedgrid.json`); `--nur-filtern` geht ohne Overpass.
- **OSRM-Steps taugen nicht als Auswertungseinheit** – einer kann 150 km lang sein.
  Deshalb feste 1-km-Abschnitte.
- **Beim Raster gewinnt die Mehrheit, nicht der strengste Wert.** Sonst überschreibt
  eine Auffahrt mit Tempo 80 die freie Hauptfahrbahn (kostet ~15 Prozentpunkte).
- **Baustellen richtungsscharf zuordnen.** Ohne Richtungsvergleich zählen die der
  Gegenfahrbahn mit – das waren 993 falsche Treffer.
- **Nur Meldungen mit Tempolimit oder Sperrung kosten Zeit.** Grünpflege und
  Wanderbaustellen pauschal einzurechnen überschätzte die Fahrzeit um über eine Stunde.
- **Overpass weist browserartige User-Agents mit HTTP 406 ab.** Schlichte Kennung nutzen.
- **Karten erst einblenden, dann zeichnen.** In einem versteckten Container hat
  Leaflet keine Größe und `fitBounds` schrumpft auf einen Punkt.
- **Schreibende Skripte dürfen bei Fehlern keine guten Daten überschreiben.**

## Modellstand (Details und Belege im README)

Kalibriert an einer GPX-Fahrt Aachen → München (6.9.2026, Sonntag): Modell trifft
das gemessene Teilstück auf die Minute. Kernwerte: `DEFAULT_SPEED` 150,
Wechselanzeige `0,2 × 120 + 0,8 × Wunsch`, LKW-Entlastung 2,0/0,1/0,05, Bremsbetrag
skaliert mit `wunsch/185`, Beschleunigen `0,7 × Δv²/v_ziel`.

**Erreichtes Tempo ist nicht Wunschtempo:** das harmonische Mittel aus einer
Aufzeichnung (135) ist Prüfgröße, nicht Eingabewert – sonst zieht das Modell
Verkehr und Beschleunigen doppelt ab.

## Offen

- Nur **eine** Fahrt belegt das Modell, und die war ein verkehrsarmer Sonntag.
  Eine Werktagsfahrt fehlt; dort greift die Untergrenze 90 km/h bei 29 % der
  Zählstellen statt der Rechnung.
- Schwächster Einzelwert: der Anlagen-Anteil 20 %.
- Vorschlag Stufe 2 und 4 aus der Rechenweg-Übersicht: Kalibrierpunkt je
  aufgezeichneter Fahrt, Koeffizienten laufend nachziehen.
  Übersicht: https://claude.ai/code/artifact/8d4bb3e5-16dd-4019-a5f8-0c0f6008a9b9
- App-Store-Weg, falls gewünscht: Capacitor → Xcode aufs eigene iPhone (kostenlos)
  → TestFlight (99 $/Jahr). Hintergrund-Ortung gibt es nur nativ.
- Overpass antwortet abends oft mit 504; die Skripte überschreiben dann nichts,
  `fetch-route-speedlimits` behält bei Teilausfall die alten Segmente.
- GitHub Actions drosselt die Cronjobs: Baustellen kommen real alle 3–6 h.

## Arbeitsweise

- Lokal arbeiten, committen. **Nur auf ausdrückliche Aufforderung pushen.**
- Vor jedem Push `git pull --rebase origin main`: der Bot committet alle 30 Minuten
  in `data/`, die Stände laufen sonst auseinander.
- Antworten auf Deutsch.
- Node ist installiert, Xcode nicht. `gh` ist angemeldet und als Git-Credential-Helper eingerichtet.
