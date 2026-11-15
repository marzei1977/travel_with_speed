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

# Aufgezeichnete Fahrt gegen die Limits halten (--pause trennt Fahrt von Halt;
# Halte ohne Aufzeichnungslücke – Rastplatz – werden über Stillstand erkannt)
node routenplaner/scripts/vergleich-fahrt.mjs fahrt.gpx --csv /tmp/v.csv [--pause 180]

# Aufgezeichnete Fahrt kilometerweise gegen das Modell: real vs. gerechnet, nach
# Streckenart, Autobahn × Fahrstreifen und Stunde. Nimmt Routen und Baustellen
# vom Fahrttag aus der Git-Historie; --lkw/--dichte/--spur3/--anlage zum Probieren.
# Enthält eine Kopie der Rechenlogik aus index.html – bei Änderungen nachziehen.
node routenplaner/scripts/abgleich-fahrt.mjs "Strecken GPS/fahrt.gpx" [korridor] [--stand aktuell]
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
- **Vollsperrungen stehen im eigenen API-Dienst `closure`**, nicht unter
  `roadworks`/`warning`, und `isBlocked` bleibt selbst dort `"false"` – maßgeblich
  ist `display_type: "CLOSURE"` (`CLOSURE_ENTRY_EXIT` sind nur Rampen). Der Dienst
  fehlte in Skript und freier Suche; die gesperrte A3 am Offenbacher Kreuz
  (14.–16.11.2026) kam deshalb nie an. Gesperrte Routen stehen jetzt am Ende,
  ihre Zeit enthält keine Umleitung.
- **Meldungen haben Beginn und Ende (`von`/`bis`) und Zeiträume über Mitternacht**
  ("24.11.26 20:00 bis zum 25.11.26 06:00"). Ohne beides gilt eine Nachtsperrung
  als dauerhaft aktiv.
- **`roadworks.json` im Service Worker erst aus dem Netz, nicht aus dem Cache** –
  sonst zeigt die installierte App den Stand vom vorigen Öffnen.
- **Overpass weist browserartige User-Agents mit HTTP 406 ab.** Schlichte Kennung nutzen.
- **Karten erst einblenden, dann zeichnen.** In einem versteckten Container hat
  Leaflet keine Größe und `fitBounds` schrumpft auf einen Punkt.
- **Schreibende Skripte dürfen bei Fehlern keine guten Daten überschreiben.**

## Modellstand (Details und Belege im README)

Kalibriert an fünf GPX-Fahrten (liegen in `Strecken GPS/`, nicht im Repo):
Aachen → München (So 6.9.2026), München ⇄ Wiesbaden (Mo 12.10.2026, A8/A7/A3),
München → Köln (Di 10.11.2026, A8/A7/A3) und Aachen → München über Karlsruhe
(So 15.11.2026). Vier trifft das Modell auf ±2 Minuten, die Dienstagsfahrt auf −6
(A8 München → Ulm im Feierabendverkehr). Kernwerte: `DEFAULT_SPEED` 150, Wechselanzeige
`0,2 × 120 + 0,8 × Wunsch`, **LKW-Gewicht 15** (war 60, dann 9), LKW-Entlastung 2,0/0,1/0,05,
Bremsbetrag skaliert mit `wunsch/185`, Beschleunigen `0,7 × Δv²/v_ziel`.

**Koeffizienten nicht an Sonntagsfahrten einstellen, die werktags wirken.** Das
LKW-Gewicht 60 stammte von der Sonntagsfahrt (LKW-Fahrverbot, ein Zehntel der
Menge) und drückte werktags jede zweispurige Strecke auf die Untergrenze 90 –
gefahren wurden dort 131 km/h, 30 Minuten Fehler je Fahrt.

**Eine Fahrt nur mit dem Baustellenstand ihres Tages nachrechnen**
(`git show <commit>:routenplaner/data/roadworks.json`, dazu die `routes.json`
desselben Commits – die Zuordnung läuft über Segmentnummern). Mit dem Stand von
fünf Tagen später sah die Dienstagsfahrt minutengenau getroffen aus; tatsächlich
fehlten 8 Minuten.

**Fahrstreifenzahlen der BASt können veraltet sein.** Rohrbrunn (A3 Spessart)
stand mit 2 statt 3 Spuren in den Daten; das zog dort 30–60 km/h zu viel ab und
verdeckte ein zu kleines LKW-Gewicht. Korrekturen stehen in `FS_KORREKTUR` in
`fetch-traffic.mjs`.

**Erreichtes Tempo ist nicht Wunschtempo:** das harmonische Mittel aus einer
Aufzeichnung (135) ist Prüfgröße, nicht Eingabewert – sonst zieht das Modell
Verkehr und Beschleunigen doppelt ab.

## Offen

- Der LKW-Abzug ist nur auf A7, A3 und A8 belegt. Die A61 liegt werktags wieder
  deutlich hinten (Köln → München Mo 8 Uhr: 5 h 11 gegen 4 h 44 über A3/A9), und
  zwar allein wegen dieses Abzugs. **Eine Werktagsfahrt über die A61** fehlt.
- A8 München → Ulm werktags tagsüber rechnet das Modell zu optimistisch
  (146 statt 131–135 km/h, gut vier Minuten).
- Frankfurt im Feierabendverkehr unter Wechselanzeige rechnet das Modell zu
  optimistisch (140 statt 124 km/h).
- Schwächster Einzelwert: der Anlagen-Anteil 20 %.
- Fahrstreifen gibt es jetzt zweimal: je Kilometer aus OSM (`speedgrid.json`,
  Feld `spuren`, für Anzeige und Reihenfolge) und je Zählstelle von der BASt
  (für den LKW-Abzug in der Fahrzeit). Naheliegender nächster Schritt: die
  Fahrzeit auf die OSM-Werte umstellen – das verschiebt aber den LKW-Abzug auf
  jedem Kilometer und braucht eine neue Kalibrierung mit `abgleich-fahrt.mjs`.
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
