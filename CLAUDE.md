# Autobahn-Routenplaner

Statische Webseite (GitHub Pages), die Routen nach **echten Tempolimits** statt nach
Durchschnittstempo bewertet. Zielgruppe ist ein Fahrer, der auf freier Strecke
180–190 fährt: für ihn kann eine längere, überwiegend unbegrenzte Route schneller
sein als die kürzeste.

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
- `routenplaner/fahrt/index.html` – Auswertung hochgeladener GPX-Aufzeichnungen
- `routenplaner/config/corridors.json` – hinterlegte Strecken und ihre Wegpunkte
- `routenplaner/scripts/*.mjs` – Datenbeschaffung, laufen per GitHub Actions
- `routenplaner/README.md` – **Modellannahmen und Grenzen ausführlich**; bei
  inhaltlichen Fragen zuerst dort nachsehen (~3.500 Token, lohnt sich)

Fünf Cronjobs halten die Daten aktuell: Baustellen alle 30 Min, Tempolimits und
Raster wöchentlich, Verkehrsdaten und Kreuze monatlich.

## Werkzeuge zum Prüfen

```bash
# Eine Strecke kilometerweise: Limit, Baustelle, gerechnetes Tempo
node routenplaner/scripts/audit-route.mjs koeln-muenchen 185 15 2026-08-11T08:00 --html /tmp/a.html

# Aufgezeichnete Fahrt gegen die Limits halten
node routenplaner/scripts/vergleich-fahrt.mjs fahrt.gpx --csv /tmp/v.csv
```

## Fehler, die schon einmal gemacht wurden

Diese Fallen sind behoben. Sie beim Ändern nicht wieder aufreißen:

- **Wegpunkte müssen exakt auf der Fahrbahn liegen.** 850 m daneben genügen, damit
  der Router die Autobahn verlässt und durch Ortschaften fährt. Das hatte einmal
  40 Minuten Fehler erzeugt und die Rangfolge gedreht.
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

## Bekannte Schwäche

Das Verkehrsmodell ist der am wenigsten belegte Teil: die Stundenverteilung ist
eine Annahme, die Koeffizienten sind an einer einzigen Referenzfahrt kalibriert.
Auf der A61 greift dabei über weite Strecken die Untergrenze von 90 km/h – ob das
realistisch ist, ist offen. **Die Kalibrierung stimmt derzeit nicht**: für die
Referenzfahrt (real 4h40) sagt das Modell 4h07. Klären soll das eine GPX-Messung
der Strecke Köln–München.

## Arbeitsweise

- Lokal arbeiten, committen. **Nur auf ausdrückliche Aufforderung pushen.**
- Vor jedem Push `git pull --rebase origin main`: der Bot committet alle 30 Minuten
  in `data/`, die Stände laufen sonst auseinander.
- Antworten auf Deutsch.
- Node ist installiert, Xcode nicht.
