# Autobahn-Routenplaner

Vergleicht für ausgewählte Fernstrecken mehrere Routen-Alternativen – nicht nach
"üblicher" Durchschnittsgeschwindigkeit, sondern nach den **tatsächlichen
Tempolimits pro Abschnitt** (aus OpenStreetMap) kombiniert mit deiner selbst
angegebenen **Wunschgeschwindigkeit auf unbegrenzten Abschnitten** und den
**aktuellen Baustellen/Sperrungen** (offizielle Autobahn-API des Bundes).

Hintergrund: Standard-Navis empfehlen oft die kürzeste oder statistisch
"schnellste" Route – die kann aber über weite Strecken tempolimitiert sein,
während eine etwas längere Alternative überwiegend unbegrenzt ist und für
schnellere Fahrer in der Praxis früher ankommt.

## Wie es funktioniert

1. **`config/corridors.json`** definiert Fernstrecken ("Korridore") mit je zwei
   oder mehr Alternativ-Routen. Jede Route wird über Zwischenpunkte (`waypoints`)
   festgelegt, die den [OSRM-Demo-Router](http://project-osrm.org/) zwingen, die
   gewünschte Autobahn-Kombination zu fahren (z. B. via Würzburg/Frankfurt für die
   A3, via Kreuz Speyer für die A61).
2. **`scripts/fetch-route-speedlimits.mjs`** holt darüber die reale
   Routengeometrie, zerlegt sie in 1-km-Abschnitte und ordnet jedem Abschnitt via
   [Overpass-API](https://overpass-api.de/) das dort in OpenStreetMap getaggte
   `maxspeed` zu (inkl. `maxspeed=none` für unbegrenzt). Ergebnis: `data/routes.json`.
   Läuft **wöchentlich** (Tempolimits ändern sich selten) – siehe
   `.github/workflows/routenplaner-routes.yml`. Kann jederzeit manuell über
   "Run workflow" angestoßen werden.
3. **`scripts/fetch-roadworks.mjs`** holt für alle in `routes.json` vorkommenden
   Autobahnen aktuelle Baustellen & Verkehrsmeldungen von der
   [Autobahn-API des Bundes](https://verkehr.autobahn.de) und ordnet sie anhand
   ihrer tatsächlichen Geometrie (nicht nur eines Einzelpunkts) den betroffenen
   1-km-Abschnitten zu. Ergebnis: `data/roadworks.json`. Läuft **alle 30 Minuten**
   – siehe `.github/workflows/routenplaner-roadworks.yml`.
4. **`index.html`** lädt beide JSON-Dateien und berechnet komplett im Browser
   (bei jeder Änderung der Wunschgeschwindigkeit neu, ohne Serveraufruf) für jede
   Route: `effektive Geschwindigkeit pro Abschnitt = min(Wunschgeschwindigkeit,
   Tempolimit bzw. Baustellen-Limit)`, daraus die Gesamtfahrzeit.

Kein eigener Server nötig – alles läuft als statische Seite (z. B. via GitHub
Pages), die Datenpflege übernehmen die beiden GitHub-Actions-Cronjobs.

## Einen weiteren Korridor hinzufügen

In `config/corridors.json` einen neuen Eintrag mit `id`, `name` und mehreren
`routes` (je mit `id`, `label`, `waypoints` als Liste von `{name, lon, lat}`)
ergänzen. Die Zwischenpunkte sollten möglichst genau auf der gewünschten Autobahn
liegen (am besten eine Anschlussstelle/ein Autobahnkreuz statt eines Stadtzentrums
wählen, sonst kann OSRM unnötige Umwege über Stadtstraßen nehmen). Danach einmal
`node routenplaner/scripts/fetch-route-speedlimits.mjs` laufen lassen (lokal oder
per "Run workflow"), anschließend `node routenplaner/scripts/fetch-roadworks.mjs`.

## Kalibrierung

Referenzfahrt München (Döllingerstr.) → Köln (Lokomotivstr.), bei 180–190 km/h
auf freier Strecke: real ca. **4 h 40 min** reine Fahrzeit. Das Modell liefert für
die A9/A3-Route bei 185 km/h **4 h 42 min** – die Zeitberechnung passt damit gut.

## Annahmen & bekannte Grenzen

- **Verkehrsdichte wird nicht abgebildet** – das ist die größte Einschränkung.
  Berechnet wird, was rechtlich und baustellenbedingt möglich ist, nicht wie voll
  die Strecke ist. Konkret: die A61-Route wird knapp als schnellste ausgewiesen,
  obwohl der A61-Abschnitt selbst nur zu 32 % unbegrenzt ist (60 % limitiert) –
  sie kompensiert das über einen langen, fast durchgehend unbegrenzten
  A8-Abschnitt und weniger Stadtanteil. In der Praxis ist die A61 eine stark
  befahrene LKW-Transitachse, was die Modellzeit dort zu optimistisch macht. Die
  Aufteilung "unbegrenzt / begrenzt" pro Route ist deshalb oft aussagekräftiger
  als die reine Zeitangabe.
- **Fehlendes `maxspeed`-Tag auf einer erkannten Autobahn**: OSM taggt nicht jeden
  Abschnitt lückenlos. In diesem Fall wird die Richtgeschwindigkeit (130 km/h)
  angenommen – in der UI als "begrenzt/Baustelle"-Farbe sichtbar, da nicht
  zweifelsfrei unbegrenzt.
- **Nur Meldungen mit belegbarer Auswirkung kosten Zeit**: eingerechnet werden
  Baustellen, die ein Tempolimit nennen ("Max. 80 km/h") oder als Sperrung
  markiert sind. Der weitaus größte Teil der Meldungen sind Grünpflege,
  Standspur-Befahrungen und stundenweise Wanderbaustellen ohne Tempolimit – diese
  werden angezeigt, aber nicht eingerechnet. Sie pauschal zu bremsen hatte die
  Fahrzeit um über eine Stunde überschätzt.
- **Anteilige Baustellenlänge**: eine 200-m-Baustelle bremst nicht den ganzen
  Kilometer, sondern nur ihren tatsächlichen Längenanteil (aus "Länge: x km").
- **Gegenfahrbahn wird ausgefiltert**: Baustellen werden je Richtung gemeldet;
  über einen Richtungsvergleich der Geometrie zählen nur die der eigenen
  Fahrtrichtung.
- **Geplante Baustellen** (`future`-Flag bzw. künftiger Beginn) bleiben außen vor.
- **Routen-Alternativen** werden über feste Zwischenpunkte erzwungen, nicht über
  eine Nachbildung dessen, was ein bestimmter kommerzieller Kartendienst gerade
  empfiehlt – die berechneten Distanzen können daher von Google/Apple Maps &
  Co. abweichen.
- **OSRM-Demo-Server**: kostenloser, öffentlicher Dienst ohne Kapazitätsgarantie.
  Für die hier genutzte Frequenz (wenige Aufrufe/Woche, nicht pro Website-Besuch)
  unkritisch; bei dauerhaften Ausfällen ggf. auf einen anderen OSRM-Host oder
  einen selbst gehosteten Router umsteigen.
- Diese Seite ersetzt keine Verkehrsschilder oder Navigationssoftware – alle
  Werte sind Schätzungen auf Basis öffentlicher, teils unvollständiger Daten.
