# Linke Spur

*Die Ankunftszeit für Leute, die zügig fahren.*

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
   oder mehr Alternativ-Routen. Jede Route wird über Zwischenpunkte (`via`, aufgelöst
   aus der `punkte`-Tabelle) festgelegt, die den
   [OSRM-Demo-Router](http://project-osrm.org/) zwingen, die gewünschte
   Autobahn-Kombination zu fahren (z. B. via Würzburg/Frankfurt für die A3, via
   Kreuz Speyer für die A61). **Hin- und Rückrichtung sind eigene Korridore**, kein
   Spiegelbild: Baustellen werden richtungsscharf zugeordnet, und tatsächlich
   betreffen von den gefundenen Meldungen nur rund 7 % beide Richtungen.
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
   1-km-Abschnitten zu. Dabei werden auch die **Gültigkeitsfenster** aus dem
   Beschreibungstext extrahiert ("18.08.26 von 08:00 bis 16:00 Uhr", "Jeden Montag …"),
   damit später nur zählt, was zur gewählten Abfahrtszeit wirklich steht.
   Ergebnis: `data/roadworks.json`. Läuft **alle 30 Minuten** – siehe
   `.github/workflows/routenplaner-roadworks.yml`.
4. **`scripts/fetch-traffic.mjs`** holt die Jahresauswertung der automatischen
   Dauerzählstellen der [BASt](https://www.bast.de) und legt je Zählstelle und
   Richtung ab: Verkehrsstärke, Schwerverkehr und **Fahrstreifenzahl**, jeweils
   getrennt nach Tagestyp (Werktag / Samstag / Sonntag / Urlaub).
   Ergebnis: `data/traffic.json`. Läuft **monatlich** (die Daten erscheinen jährlich)
   – siehe `.github/workflows/routenplaner-traffic.yml`.
5. **`index.html`** lädt die drei JSON-Dateien und berechnet komplett im Browser
   (bei jeder Eingabeänderung neu, ohne Serveraufruf) für jede Route:
   `effektive Geschwindigkeit pro Abschnitt = min(Wunschgeschwindigkeit,
   Tempolimit, ggf. Baustellen-Limit, ggf. verkehrsbedingt fahrbares Tempo)`,
   daraus die Gesamtfahrzeit.

Kein eigener Server nötig – alles läuft als statische Seite (z. B. via GitHub
Pages), die Datenpflege übernehmen die drei GitHub-Actions-Cronjobs.

## Übersichtstabelle und Google-Maps-Export

Über den Routenkarten steht eine Vergleichstabelle mit Strecke und
Zwischenzielen, Distanz, Anteil unbegrenzt/begrenzt inklusive Baustellenkilometer
sowie zwei Fahrzeiten samt Durchschnittsgeschwindigkeit: **Dienstag 08:00** als
Werktagsfall und **Sonntag 07:00** als ruhiger Fall, beide mit eingerechnetem
Verkehr.

Diese beiden Zeitpunkte sind bewusst fest verdrahtet und folgen *nicht* dem
Abfahrtsfeld – sonst wären die Zeilen nicht mehr untereinander vergleichbar. Wer
eine konkrete Abfahrt bewerten will, nutzt das Feld oben und liest die
Routenkarten darunter.

Ein Klick auf eine Zeile hebt die Strecke in der Karte hervor: durchgezogene
Linie, alle anderen gestrichelt. Erneuter Klick hebt die Auswahl auf, dann ist
die schnellste hervorgehoben. Dasselbe geht über die Kartenlegende oder direkt
auf einer Linie.

Die Spalte **Maps** öffnet die jeweilige Route in Google Maps (URL-Schema
`api=1`). Die Zwischenziele stammen bewusst **nicht** aus den konfigurierten
Kreuz-Koordinaten, sondern werden gleichmäßig aus der berechneten
Streckengeometrie entnommen – und nur dort, wo die Route auf einer Autobahn
läuft. Grund: Maps ordnet eine Koordinate der nächstgelegenen adressierbaren
Stelle zu, und neben einem Autobahnkreuz ist das gern ein Gewerbebetrieb an der
Nebenstraße; Maps leitet dann über diese Straße statt über die Autobahn. Punkte
aus der Geometrie liegen dagegen exakt auf der Fahrbahn.

Auch damit gilt: Maps übernimmt nur die Stützpunkte, *zwischen* ihnen wählt es
den Weg weiterhin selbst. Start und Ziel bleiben die konfigurierten Adressen;
dafür lädt die Seite zusätzlich `config/corridors.json`.

Ganz unten listet der Abschnitt **Datenstand** für jede Quelle Herkunft und
Abrufzeitpunkt auf, inklusive des Hinweises, dass die Stundenverteilung eine
Modellannahme ist.

## Toleranz über ausgeschilderten Limits

Praktisch niemand fährt exakt das ausgeschilderte Limit. Über die Einstellung
„Tempo über ausgeschilderten Limits" lässt sich ein Zuschlag von 0 bis 20 km/h
wählen, der auf **echte Limits** angewendet wird: getaggte `maxspeed`-Werte, die
als Limit-Ersatz angesetzte Richtgeschwindigkeit auf ungetaggten
Autobahnabschnitten und Baustellen-Tempolimits.

Nicht angewendet wird er auf Ortsdurchfahrten und Zubringer. Dort steht kein
Limit in den Daten, sondern die von OSRM aus dem Straßentyp abgeleitete
tatsächliche Reisegeschwindigkeit – die um 15 zu erhöhen wäre sinnlos. Ebenso
unberührt bleiben gemeldete Sperrungen.

Größenordnung auf der Referenzstrecke Köln → München (604 km, davon rund 100 km
mit ausgeschildertem Limit): +15 km/h sparen etwa zehn Minuten. Der Effekt ist
also spürbar, aber deutlich kleiner als der Einfluss der Wunschgeschwindigkeit
auf den unbegrenzten Abschnitten.

Die ausgeschilderten Limits sind selbstverständlich verbindlich – die
Einstellung dient dazu, die Schätzung an das tatsächliche Fahrverhalten
anzupassen.

## Abfahrtszeit und Verkehrsaufkommen

Die Fahrzeit hängt stark davon ab, *wann* man fährt – deshalb gibt es ein
Abfahrtsfeld und einen Schalter für das Verkehrsaufkommen.

**Die Zeit schreitet während der Fahrt fort.** Jeder Kilometer wird mit dem
Zeitpunkt bewertet, zu dem man ihn tatsächlich erreicht – nicht mit der
Abfahrtszeit. Wer um 14 Uhr in Köln startet, ist bei Würzburg erst gegen 16:30
und dort in einer anderen Verkehrslage. Da die Zeit an einem Abschnitt nur von
den Abschnitten davor abhängt, genügt dafür ein Vorwärtsdurchlauf.

Der Unterschied ist erheblich: gegenüber einer starren Bewertung mit der
Abfahrtszeit verschieben sich die Fahrzeiten um bis zu 14 Minuten, je nachdem ob
man in eine Spitze hinein- oder aus ihr herausfährt. Auch der Tagestyp wechselt
unterwegs korrekt – eine Fahrt Samstag 22 Uhr kommt sonntags an und profitiert
auf dem zweiten Teil vom LKW-Fahrverbot. Die berechnete Ankunftszeit steht auf
jeder Routenkarte.

**Die Abfahrtszeit wirkt auf zwei Dinge:**

- *Welche Baustellen gelten.* Ein Teil der Meldungen sind reine Tagesbaustellen
  oder wiederkehrende Wochentagsfenster. Nachts und sonntags fallen sie weg. Der
  Rest sind Dauerbaustellen, die immer zählen.
- *Wie dicht der Verkehr ist.* Über eine Tagesganglinie (Modellannahme, siehe
  Grenzen) und den BASt-Tagestyp. Freitagnachmittag und Sonntagabend bekommen
  einen Zuschlag für die bekannten Reisewellen.

**Der Verkehrsschalter unterscheidet zwei Lesarten:**

- *Aus* – die rechtlich mögliche Fahrzeit bei freier Bahn. Das ist der Bestfall,
  den man nachts oder früh am Morgen tatsächlich fährt.
- *Ein* – zusätzlich gebremst durch Verkehrsdichte und LKW-Anteil. Das ist die
  realistische Erwartung für einen normalen Tag.

Beide Zahlen sind richtig, sie beantworten nur verschiedene Fragen. Ein einzelner
Wert kann beides nicht leisten: der Bestfall-Referenzwert (siehe Kalibrierung)
lässt sich nicht mit einem Durchschnitts-Verkehrsaufschlag verrechnen.

Warum der LKW-Anteil überhaupt eingeht: auf einer zweispurigen Richtungsfahrbahn
blockiert ein überholender LKW beide Fahrstreifen, ab drei Spuren bleibt links
meist Platz. Die BASt-Daten zeigen den Unterschied – die A61 hat mit im Mittel 2,1
Fahrstreifen die wenigsten und mit rund 20 % den höchsten Schwerverkehrsanteil,
die A9 dagegen 3,1 Spuren bei rund 13 %. Wie *viel* das kostet, ist allerdings
weit weniger, als lange angenommen: zwei Werktagsfahrten zeigen auf zweispurigen
Abschnitten dasselbe Tempo wie am Sonntag (siehe Kalibrierung, Werktagsfahrten).

## Was in einer Ergebniskarte steht

Je Strecke eine Karte, darunter erst die Landkarte. Früher standen die Zeiten
oben und ein Vergleich als Tabelle unter der Karte – dieselben Zahlen an zwei
Stellen, mit der Karte dazwischen. Jetzt trägt jede Ergebniskarte alles:

- Fahrzeit und Ankunft **zur oben gewählten Abfahrt**, dazu Strecke,
  Durchschnitt, Anteil unbegrenzt sowie Baustellen-Kilometer und Zeitverlust
  durch Verkehr, wo es sie gibt.
- **Kilometer unter Wechselanzeige** – unbegrenzte Strecke mit einer
  Streckenbeeinflussungsanlage darüber. Auf Köln → München sind das je nach
  Route 67 bis 117 km.
- Die **Leiste** teilt die Strecke in vier statt bisher drei Abschnitte:
  unbegrenzt, unbegrenzt unter Wechselanzeige (schraffiert), begrenzt, Ort. Die
  Trennung lohnt sich, weil hinter beiden Grüntönen ein sehr verschiedenes
  Fahrgefühl steckt.
- **Fahrstreifen**: Anteil der Strecke mit drei oder mehr Spuren je Richtung
  und – die eigentlich gesuchte Sorte – Anteil **dreispurig und unbegrenzt**.
  Darunter ein zweites, blaues Band: ab 3 Spuren unbegrenzt, ab 3 Spuren
  begrenzt, 2 Spuren. Auf drei Spuren bleibt die linke meist frei; das zeigt
  die Minutenrechnung allein nicht. München → Köln: A9/A3 90 % dreispurig
  (73 % dreispurig und unbegrenzt), A8/A7 68 % (53 %), A61-Route 53 % (32 %).
  Über **„Reihenfolge nach"** lassen sich die Ergebnisse statt nach Fahrzeit
  nach einem der beiden Anteile ordnen; „Schnellste" bleibt an der schnellsten.
  Die Spurzahl stammt aus dem OSM-Tag `lanes` und liegt im bundesweiten Raster
  (`speedgrid.json`, Feld `spuren`), gilt also auch für frei gesuchte
  Strecken. Eine Rasterzelle fasst beide Fahrtrichtungen zusammen; wo sie sich
  unterscheiden, gewinnt die Mehrheit. Dieselben Werte gehen in die
  Fahrzeitrechnung ein (siehe Kalibrierung, „Fahrstreifen je Kilometer").
- Die **beiden Referenzzeiten** (Werktag Di 08:00, Wochenende So 07:00), beide
  mit Verkehr. Sie hängen nicht an der gewählten Abfahrt und machen die Strecken
  untereinander vergleichbar.
- **Maps-Verknüpfung** und die **Baustellenmeldungen** zum Aufklappen, mit der
  Zahl der eingerechneten Meldungen.

Ein Klick auf die Karte hebt die Strecke in der Landkarte hervor – dieselbe
Geste wie ein Klick auf die Linie oder die Legende.

## Fahrten selbst aufzeichnen

`aufzeichnen/` schreibt die laufende Fahrt direkt mit – ohne fremde App und ohne
Dateien hin- und herzuschieben. Am Ziel führt ein Tippen auf "Auswerten" in
dieselbe Kilometerwertung, die sonst eine hochgeladene GPX-Datei durchläuft.

**Die Grenze zuerst, weil sie den Umgang bestimmt:** iOS und Android geben
Web-Apps keinen Standort im Hintergrund. Sperrst du den Bildschirm oder wechselst
die App, entsteht eine Lücke in der Spur. Die Seite fordert deshalb einen
Wake Lock an (Safari ab 16.4), damit der Bildschirm anbleibt, und sagt das auch.
Für eine Autobahnfahrt mit dem Telefon in der Halterung am Ladekabel taugt das;
für "Handy in die Tasche und losfahren" nicht. Nur eine native App käme an
`CoreLocation` im Hintergrund heran.

Wie aufgezeichnet wird:

- Ein Punkt je Ortung über `watchPosition` mit `enableHighAccuracy`. Punkte mit
  einer Unschärfe über **50 m** fliegen sofort raus: unter freiem Himmel liefert
  ein Telefon 5 bis 15 m, alles darüber stammt aus WLAN- oder Funkzellenortung
  und würde die Kilometerwertung verfälschen.
- Gespeichert wird in **IndexedDB**, nicht in `localStorage`. Eine sechsstündige
  Fahrt sind rund 20.000 Punkte – damit ist der Rahmen von `localStorage` längst
  gesprengt.
- Geschrieben wird **minütlich in Blöcken**, nicht erst am Ende. Stürzt der
  Browser ab, fehlt höchstens die letzte Minute; die Fahrt bleibt als
  "unvollständig beendet" in der Liste stehen und lässt sich trotzdem auswerten.
- **GPX-Export** über das Teilen-Blatt (Telefon) oder als Download (Rechner),
  damit die Aufzeichnungen nicht im Browser gefangen sind.

Die Übergabe an die Auswertung läuft über `fahrt/?aufzeichnung=<id>`; die
Auswerteseite liest die Punkte direkt aus IndexedDB.

## Was die Fahrtauswertung zeigt

`fahrt/` wertet eine GPX-Datei oder eine hier aufgezeichnete Fahrt aus:

- **Streckenverlauf** auf der Karte, je Kilometer nach Tempo eingefärbt.
- **Tempoprofil**: gefahrenes Tempo, Modell und Limit über die Strecke, Halte
  als senkrechte Marken. Zeiger oder Pfeiltasten zeigen je Kilometer alle Werte.
- **Vorhersage gegen gefahren**: Der Rechenkern des Planers (`modell.js`)
  rechnet jeden Autobahnkilometer zur tatsächlichen Uhrzeit nach – Limit,
  Wechselanzeige, Verkehr, Fahrstreifen, Beschleunigen – und stellt die
  Abweichung nach Streckenart und nach Autobahn × Fahrstreifen dar. **Ohne
  Baustellen**: die des Fahrttags kennt der Browser nicht, wo eine stand, ist
  das Modell hier zu schnell. Für die Dienstagsfahrt vom 10.11. ergibt das −8
  Minuten, der genaue Abgleich mit Baustellen (`abgleich-fahrt.mjs`) −6.
- **Verlauf**: gespeicherte Fahrten mit gleichem Start und Ziel (je auf 8 km)
  stehen als eine Strecke untereinander – Wochentag, Abfahrt, Fahrzeit, Schnitt.
- Kennzahlen für den Planer, Kilometertabelle und der Vergleich zweier Fahrten
  wie bisher.

`modell.js` ist dieselbe Datei, die `abgleich-fahrt.mjs` lädt. `index.html` und
`audit-route.mjs` tragen die Logik noch als eigene Kopie.

## Als App aufs Telefon (PWA)

Die Seite ist eine installierbare Web-App. Auf dem iPhone: in Safari öffnen,
Teilen-Symbol, "Zum Home-Bildschirm". Danach startet sie mit eigenem Icon und
ohne Browserleiste. Android/Chrome bietet die Installation von selbst an.

Im Standalone-Modus rechnen die Seiten mit `env(safe-area-inset-*)`, damit der Kopf
nicht unter der Uhr und die Ränder nicht unter den abgerundeten Ecken sitzen. Ein
`.nojekyll` im Wurzelverzeichnis sorgt dafür, dass GitHub Pages `sw.js`,
`manifest.webmanifest` und die Ordner `icons/` und `vendor/` unverändert ausliefert.

**Offline** funktioniert alles, was aus den mitgelieferten Daten kommt: die
hinterlegten Korridore samt Routenvergleich, die gespeicherten Baustellen und die
GPX-Auswertung. Ein Service Worker (`sw.js`) legt dafür zwei Sorten von Dateien
ab:

- Die App-Shell – beide Seiten, Leaflet, Icons, `config/corridors.json` – kommt
  beim Installieren automatisch in den Cache. Zusammen rund 350 KB.
- Die Streckendaten (`data/*.json`, zusammen etwa 6 MB) lädt niemand ungefragt.
  Dafür gibt es unten auf der Seite den Knopf **"Offline verfügbar machen"**.

Was offline *nicht* geht, weil es live abgefragt wird: die freie Ortssuche
(Photon), Routen außerhalb der hinterlegten Korridore (OSRM), frische
Baustellenmeldungen und neue Kartenkacheln. Die zuletzt betrachteten Kacheln
bleiben begrenzt zwischengespeichert (400 Stück), damit die Karte nicht leer ist.

Leaflet liegt deshalb unter `vendor/leaflet/` statt vom CDN zu kommen – geprüft
gegen die SRI-Hashes der vorherigen Einbindung. Erscheint eine neue Fassung der
Seite, meldet sich der Fuß mit "Jetzt aktualisieren"; übernommen wird erst auf
Klick, damit niemandem mitten in der Routensuche die Seite neu lädt.

Beim Ändern von `sw.js` die `VERSION` hochzählen, sonst behalten bestehende
Installationen ihren alten Cache.

## Freie Suche: woher die Alternativen kommen

Für eine selbst eingegebene Strecke fragt die Seite OSRM nach Alternativen und
erzwingt zusätzliche Varianten über Autobahnkreuze aus `data/junctions.json` –
nötig, weil OSRM nach seiner eigenen Zeitschätzung aussiebt und die bei rund
110 km/h gedeckelt ist: Der Unterschied zwischen unbegrenzt und 130 existiert
dort nicht.

Diese Kreuze müssen genauso sauber auf der Fahrbahn liegen wie die Wegpunkte der
hinterlegten Korridore. `fetch-junctions.mjs` prüft das zweifach: Der Name muss
auf ein eigenständiges "Kreuz" oder "Dreieck" enden, und der Punkt muss nach
`speedgrid.json` höchstens 600 m von einer Autobahn entfernt liegen. Ohne die
Prüfung waren 31 von 336 Einträgen falsch – darunter Bundesstraßen-Dreiecke, ein
Rastplatz und die Stadt Kreuztal.

## Einen weiteren Korridor hinzufügen

In `config/corridors.json` zuerst benötigte Wegpunkte in die `punkte`-Tabelle
eintragen, dann einen Korridor mit `id`, `name`, `von`, `nach` und mehreren
`routes` (je mit `id`, `label`, `via` als Liste von Punkt-Schlüsseln) ergänzen.
Für die Gegenrichtung einen zweiten Korridor mit umgekehrter `via`-Reihenfolge
anlegen.

**Zwischenpunkte gehören nicht in das Autobahnkreuz, sondern einige Kilometer
dahinter auf die Zielfahrbahn.** Ein Punkt im Kreuz selbst snappt bei OSRM leicht
auf eine Verbindungsrampe; um sie zu erreichen, fährt die Route am Kreuz vorbei,
wendet und kommt zurück. Das kostet ohne jede Warnung 8 bis 32 km je Punkt – am
Frankfurter Kreuz waren es 32 km und rund 15 Minuten. Weil die Richtungsfahrbahnen
in OSM getrennte Wege sind, ist ein solcher Punkt außerdem **richtungsabhängig**:
derselbe Punkt taugt nicht für Hin- und Rückweg. Deshalb heißen die Punkte nach
Kreuz, Autobahn und Fahrtrichtung – `biebelried-a7sued` gilt für Köln → München,
`biebelried-a7nord` für München → Norddeich.

Nach jeder Änderung prüfen, dass keine Kehrtwende entstanden ist: in
`data/routes.json` darf kein Abschnitt einem mehr als drei Kilometer früheren
Abschnitt wieder auf 300 m nahekommen. Danach einmal
`node routenplaner/scripts/fetch-route-speedlimits.mjs` laufen lassen (lokal oder
per "Run workflow"), anschließend `node routenplaner/scripts/fetch-roadworks.mjs`.

## Kalibrierung

Referenzfahrt München (Döllingerstr.) → Köln (Lokomotivstr.), bei 180–190 km/h
auf freier Strecke: real ca. **4 h 40 min** reine Fahrzeit. Das Modell liefert für
die A9/A3-Route bei 185 km/h **4 h 42 min ohne Verkehrsaufkommen** – passt.
Mit eingerechnetem Verkehr an einem Werktagvormittag sind es rund 5 h 17 min, und
die A9/A3 setzt sich dann korrekt vor die A61.

Zweite Referenzfahrt, Gegenrichtung: Köln → München über A3/A7/A8 an einem
Sonntagnachmittag (16:15), real **4 h 40 min**. Das Modell bei 185 km/h und
eingerechnetem Verkehr:

| Toleranz | Modell | Abweichung |
|---|---|---|
| 0 | 4 h 54 min | +14 min |
| +10 km/h | 4 h 47 min | +7 min |
| +15 km/h | 4 h 44 min | +4 min |

Beide Referenzfahrten werden also mit +10 bis +15 km/h Toleranz auf wenige
Minuten genau getroffen.

### Dritte Referenzfahrt: gemessen statt geschätzt

Aachen → München am 6.9.2026, als GPX aufgezeichnet und mit
`vergleich-fahrt.mjs` ausgewertet: 678 km, 5 h 38 min reine Fahrzeit
(+ 4 min Halt), Ø 120 km/h. *(Nachtrag 12.10.2026: darin steckte ein
9-Minuten-Halt bei Rothenburg, den das Werkzeug damals nicht als Halt erkannte,
weil die App auf dem Rastplatz weiter Punkte aufzeichnete. Richtig sind 5 h 28
Fahrzeit und 9 + 4 min Halt. Die Schlüsse unten ändert das nur um wenige Minuten.)*

Das Entscheidende daran ist nicht die Gesamtzeit, sondern das **gemessene Tempo
auf freier Strecke**: auf den 508 unbegrenzten Kilometern Ø **147 km/h**, Median
152, oberes Viertel erst ab 171. Auf den 153 begrenzten Kilometern lag das Tempo
im Mittel **5 km/h unter** dem Limit.

Damit ist die Annahme "180–190 auf freier Strecke" widerlegt – sie war eine
Selbsteinschätzung, das Messergebnis liegt rund 35 km/h darunter. Genau daher kam
die Lücke der ersten Kalibrierung: mit 185 km/h und +15 Toleranz sagt das Modell
für Köln → München 4 h 06 min, mit 150 km/h dagegen 4 h 43 min. Nicht das Modell
war zu optimistisch, sondern der eingegebene Wunschwert. Die Voreinstellung im
Planer steht deshalb auf **150 km/h** (zwischen Mittel 147 und Median 152) und die
Toleranz auf 0.

Auf dem Stück, das sich mit einer hinterlegten Route deckt – Frankfurter Kreuz →
München über A7/A8 –, kommt das Modell der Messung nahe: real 3 h 15 min für
417 km, Modell 3 h 10 min für 416 km (bei 150 km/h, Toleranz 0, nach der
Wegpunkt-Korrektur). Fünf Minuten zu optimistisch auf gut drei Stunden. Die
Behandlung von Limits, Baustellen und Verkehr stimmt also im Groben; unsicher war
vor allem der Wunschwert.

### Was die Messung am Verkehrsmodell geändert hat

Der Restfehler verteilte sich zunächst sehr ungleich. Kilometerweise gegen die
Fahrt gerechnet, nach Autobahn und Wechselanzeige gruppiert, lag das Modell so:

| Gruppe | km | Modell | gemessen |
|---|---|---|---|
| A8 ohne Anzeige | 96 | 144 | 159 |
| A3 ohne Anzeige | 89 | 138 | 155 |
| A7 ohne Anzeige | 92 | 142 | 144 |
| A61 unter Anzeige | 21 | 133 | 109 |

Die A61 wurde zu optimistisch gerechnet, A3 und A8 zu pessimistisch – die
Rangfolge der Alternativen stand damit auf dem Kopf. Drei Änderungen folgten
daraus (gewichteter Fehler 8,4 → 6,3 km/h):

1. **Der Bremsbetrag skaliert jetzt mit dem Wunschtempo** (`wunsch / 185`). Er war
   an 185 km/h kalibriert, wurde aber als absoluter Abzug verwendet; bei 150 km/h
   fiel er dadurch viel zu groß aus. Bei 185 ändert sich nichts, die früheren
   Referenzfahrten bleiben also gültig.
2. **Die Fahrstreifen-Spreizung wurde verstärkt**: der LKW-Entlastungsfaktor geht
   von 1,0 / 0,45 / 0,25 auf **2,0 / 0,1 / 0,05**, das LKW-Gewicht von 50 auf 60.
   *(Das LKW-Gewicht steht inzwischen auf 15 – siehe Werktagsfahrten und
   „Fünf Fahrten“.)*
   Auf zwei Spuren wiegt der Schwerverkehr damit doppelt, ab drei Spuren fast
   nichts mehr. Das entspricht der Erfahrung, dass sich auf der A61 links kaum
   überholen lässt, und deckt sich mit den BASt-Daten: 2,11 Fahrstreifen bei
   20,4 % Schwerverkehr gegen 3,06 Spuren bei 12,2 % auf der A9.
3. **Wechselanzeigen werden erfasst und eingerechnet** (siehe unten).

Der Dichteterm blieb bei 4,0. Die Rastersuche wollte ihn halbieren, aber eine
einzelne verkehrsarme Sonntagsfahrt kann ihn nicht belegen, und er entscheidet
über das Stauverhalten an Werktagen. Ihn festzuhalten kostet nur 1,1 km/h
Genauigkeit.

Kontrollrechnung Köln → München, Werktag 8 Uhr, 185 km/h: A3/A9 4 h 16, A7/A8
4 h 42, A61 4 h 58. Vor der Änderung lag die A61 mit 4 h 06 vorn – die Reihenfolge
ist jetzt die, die der Praxis entspricht.

### Beschleunigen nach Limits und Baustellen

Jeder Kilometer wird mit einem konstanten Tempo gerechnet — endet eine 80er-Baustelle,
stand im nächsten Kilometer bis vor kurzem sofort das volle Wunschtempo an. Real
vergehen dafür rund 40 Sekunden und fast ein ganzer Kilometer.

Die Form des Zuschlags kommt aus der Physik: `Verlust = Δv² / (2·a·v_ziel)`, also
quadratisch im Tempoanstieg und fallend im Zieltempo. Angesetzt wird er ab 15 km/h
Anstieg, gemessen gegen das *langsamste* Tempo des vorigen Kilometers — wer eine
Baustelle durchfährt, beschleunigt danach aus dem Baustellentempo heraus, nicht aus
dem Mittelwert des Kilometers.

Der Vorfaktor (0,7) ist an der Aufzeichnung kalibriert, und zwar an der richtigen
Teilmenge. Von 65 gemessenen Beschleunigungsvorgängen begannen nur **31 in einem
ausgeschilderten Limit** (zusammen 9,3 min); die anderen 34 waren Beschleunigen nach
verkehrsbedingtem Abbremsen (10,5 min) — die stecken bereits im Wunschtempo und
dürfen hier nicht ein zweites Mal zählen. Das Modell findet auf derselben Strecke
ebenfalls 31 Anstiege, was für die Erkennung spricht.

Auf Köln → München macht der Zuschlag 4 bis 8 Minuten aus, je nach Zahl der
Limitwechsel. Der eigentliche Gewinn ist nicht die Gesamtzeit, sondern der Vergleich:
Eine Route mit vielen Limitwechseln wird jetzt gegenüber einer durchgehend freien
richtig bewertet.

### Erreichtes Tempo ist nicht Wunschtempo

Das Auswertewerkzeug nennt für die freien Abschnitte jetzt das **harmonische** Mittel
(135 km/h für die Referenzfahrt) statt des arithmetischen (149). Für die Fahrzeit
zählt, dass ein Kilometer bei 60 km/h eine Minute dauert und einer bei 180 nur zwanzig
Sekunden — im einfachen Mittel wiegen beide gleich, in der Fahrzeit nicht.

**Dieser Wert gehört aber nicht ins Eingabefeld.** Er ist die Prüfgröße für eine
Prognose: so schnell war man wirklich. Das Wunschtempo ist der Ausgangswert, von dem
das Modell Verkehr und Beschleunigen erst noch abzieht — trüge man dort die erreichten
135 ein, zöge es beides ein zweites Mal ab. Nachgerechnet: Frankfurter Kreuz → München
dauerte real 3 h 15; das Modell liefert mit Wunschtempo 150 exakt diese Zeit, mit 135
dagegen 3 h 29. Das Werkzeug schlägt deshalb den Median vor (hier 155) und schreibt
den Unterschied dazu.

### Wechselverkehrszeichen

Streckenbeeinflussungsanlagen zeigen Limits, die auf keinem festen Schild stehen.
OSM markiert sie mit `maxspeed:variable`; bundesweit tragen **8.215**
Autobahnabschnitte dieses Tag, **4.298** davon bei `maxspeed=none`. Diese Strecken
galten im Modell als unbegrenzt, obwohl dort eine Anlage steht, die bei Bedarf
begrenzt.

Die gefahrene Strecke zeigt den Unterschied innerhalb derselben Autobahn:

| | ohne Anzeige | unter Anzeige |
|---|---|---|
| A3 | 113 km, Ø 152 | 67 km, Ø 144 |
| A61 | 12 km, Ø 125 | 23 km, Ø 109 |
| alle unbegrenzten Kilometer | 371 km, Ø **149** | 137 km, Ø **139** |

Gerechnet wird kein fester Deckel, sondern ein Erwartungswert: die Anlage schaltet
nur einen Teil der Zeit, deshalb `0,2 × 120 + 0,8 × Wunschtempo`. Bei 150 km/h
ergibt das 144 km/h – genau der Wert, der auf der A3 unter Anzeige gemessen wurde.
So trägt der Ansatz auch bei anderen Wunschgeschwindigkeiten, statt an einer
festen Zahl zu kleben. Wo ohnehin ein Limit gilt, bleibt die Anlage außen vor: sie
zeigt dann in aller Regel dasselbe oder weniger.

Nebeneffekt für die Auswertung: `vergleich-fahrt.mjs` und die Upload-Seite weisen
Kilometer unter Anzeige getrennt aus und lassen sie aus dem Wunschtempo heraus.
Daher stammt der belastbarere Wert von 149 km/h statt der ursprünglichen 147.

Zwei Einschränkungen dazu: das Wunschtempo stammt aus derselben Fahrt, gegen die
hier geprüft wird – für den freien Anteil ist das keine unabhängige Bestätigung.
Und die Fahrweise schwankt erheblich: dieselbe Person fuhr auf den früheren
Referenzfahrten deutlich schneller als hier. Ein einzelner Vorgabewert kann das
nicht abbilden, deshalb bleibt das Feld verstellbar.

### Werktagsfahrten: der LKW-Abzug war siebenfach zu hoch

München → Wiesbaden und zurück am Montag, 12.10.2026 (9:23 und 15:28 Uhr), beide
über A8/A7/A3 und als GPX aufgezeichnet. Kilometerweise gegen die hinterlegte
Route A7/A8 gerechnet, jeweils zur tatsächlichen Uhrzeit, Wunschtempo 150,
Toleranz 0, Pausenkilometer herausgenommen:

| 426 km gemeinsame Strecke | real | Modell (LKW 60) | Modell (LKW 9) |
|---|---|---|---|
| hin, Vormittag | 3 h 18 | 3 h 45 (+27) | 3 h 15 (−3) |
| zurück, Nachmittag/Abend | 3 h 13 | 3 h 44 (+31) | 3 h 16 (+3) |
| Aachen → München (Sonntag), Teilstück 500 km | – | +7 | +3 |

Gut 20 der knapp 30 Minuten entstanden auf **zweispurigen Abschnitten** (A7
Ulm–Würzburg, A3 Spessart): Das Modell rechnete dort 90 km/h, gefahren wurden
131 bzw. 140. Nachgerechnet an der A7 um 11 Uhr: rund 280 LKW pro Stunde und
Richtung, auf zwei Spuren also 140 je Spur, ergeben `140/100 × 60 × 2,0` = 168
km/h Abzug, auf Wunschtempo 150 skaliert 136 – übrig blieben 14 km/h, die
Untergrenze hob das auf 90.

Der Grund: das LKW-Gewicht war an der Sonntagsfahrt eingestellt worden. Sonntags
gilt das LKW-Fahrverbot, die Zählstelle Langenau meldet dann 581 Schwerfahrzeuge
am Tag statt 4.576 werktags. Der Koeffizient wurde bei einem Zehntel der Menge
bestimmt und am Werktag weit über seinen Messbereich hinaus angewendet. Gemessen
liegt das Tempo auf den zweispurigen Abschnitten werktags (130/131 km/h) genau
dort, wo es sonntags lag (131) – für diese Fahrweise kosten die LKW dort praktisch
nichts. Auf drei Spuren traf das Modell schon vorher (130 gegen 129/133).

Eine Rastersuche über den Faktor (×1 bis ×0) ergab das Minimum bei ×0,1 bis ×0,2;
gewählt ist **×0,15, also LKW-Gewicht 9**. Die Untergrenze 90 km/h greift damit an
einem Werktagvormittag bei keiner Zählstelle mehr (vorher 38 %).

Was sonst noch auffiel, aber nicht geändert wurde:

- Frankfurt im Feierabendverkehr unter Wechselanzeige: real 124, Modell 140 – drei
  Minuten zu optimistisch. Der Anlagen-Anteil von 20 % ist ein Tagesmittel.
- Die Zählstelle Rohrbrunn (A3 Spessart) steht mit zwei Fahrstreifen in den Daten;
  gefahren wurden dort 155–179 km/h. Vermutlich ist der Ausbau neuer als der
  Datenstand. *(Bestätigt und korrigiert, siehe „Fünf Fahrten“.)*
- An Limits lag das Tempo im Mittel 3–5 km/h darüber, wie schon auf der ersten
  Aufzeichnung.
- Wunschtempo 150 bestätigt: Median auf freien Abschnitten 149 und 153 (Sonntag 152).

**Folge für die Rangfolge.** Köln → München, Montag 8 Uhr: vorher A3/A9 4 h 57,
A7/A8 5 h 21, A61 5 h 30 – jetzt 4 h 49, 4 h 52, 4 h 55. Die A61 bleibt hinten,
aber nur noch knapp. Ihr früherer großer Rückstand hing fast ganz am LKW-Abzug,
und der ist nur auf A7 und A3 gemessen, nicht auf der A61 selbst. Eine
Werktagsfahrt über die A61 ist deshalb der nächste sinnvolle Prüfpunkt.

Ohne Verkehrsfaktor liegt die A61-Route zeitlich knapp vorn, obwohl der
A61-Abschnitt selbst nur zu rund einem Drittel unbegrenzt ist – sie kompensiert
das über einen langen, fast durchgehend unbegrenzten A8-Abschnitt und weniger
Stadtanteil. Erst das Verkehrsaufkommen dreht die Reihenfolge um, seit der
Werktagskorrektur aber nur noch um wenige Minuten.

### Fünf Fahrten: Rohrbrunn hatte drei Spuren, das LKW-Gewicht steigt auf 15

Zwei weitere Aufzeichnungen: München → Köln am Dienstag, 10.11.2026 (16:44 Uhr,
über A8/A7/A3, 597 km, 5 h 03 Fahrzeit) und Aachen → München am Sonntag,
15.11.2026 (12:35 Uhr, über A4/A3/A5/A8 – Karlsruhe und Stuttgart –, 653 km,
5 h 24). Alle fünf Fahrten wurden kilometerweise gegen das Modell gerechnet,
jeder Kilometer zur tatsächlichen Uhrzeit, Wunschtempo 150, Toleranz 0.

**Erst die Methode, weil sie das Ergebnis kippt:** gerechnet wird mit dem
Baustellenstand *des Fahrttags* (`git show <commit>:routenplaner/data/roadworks.json`,
zusammen mit der `routes.json` desselben Commits, weil die Meldungen über
Segmentnummern zugeordnet sind). Mit dem Stand von fünf Tagen später traf das
Modell die Dienstagsfahrt scheinbar auf die Minute – dort standen 46 km
Baustelle auf der Strecke, am Fahrttag waren es 9. Der richtige Stand zeigt
8 Minuten Fehler.

Zwei Befunde:

1. **Die Zählstelle Rohrbrunn (A3 Spessart) steht mit zwei Fahrstreifen in den
   BASt-Daten, die Strecke hat drei.** Die Nachbarn Weibersbrunn und
   Würzburg-West führen drei. Auf vier Fahrten wurden dort 173, 154, 181 und
   174 km/h gefahren, gerechnet waren 140, 118, 119 und 127 – jedes Mal 1,5 bis
   3 Minuten zu langsam. `fetch-traffic.mjs` korrigiert die Zahl jetzt über
   `FS_KORREKTUR`.
2. **Dieser Fehler hatte ein zu kleines LKW-Gewicht verdeckt.** Die 9 trafen die
   beiden Montagsfahrten nur, weil Rohrbrunn 2–3 Minuten zu viel abzog. Ohne
   diesen Ausgleich liegt das Modell an allen drei Werktagsfahrten zu
   optimistisch. Rastersuche über Dichteterm, LKW-Gewicht und Drei-Spur-Faktor:
   das Minimum liegt bei LKW-Gewicht 13 bis 16 und ist flach, die beiden anderen
   Größen bringen nichts Belastbares und bleiben. Gewählt ist **15**.

| zugeordnete Autobahn-km | real | LKW 9, Rohrbrunn 2 Spuren | LKW 9, Rohrbrunn 3 | **LKW 15, Rohrbrunn 3** |
|---|---|---|---|---|
| Aachen → München, So 6.9. (564 km) | 4 h 17 | −1 | −2 | **−1** |
| München → Wiesbaden, Mo 12.10. vorm. (418 km) | 3 h 11 | −5 | −7 | **−2** |
| Wiesbaden → München, Mo 12.10. nachm. (418 km) | 3 h 09 | −1 | −3 | **0** |
| München → Köln, Di 10.11. (574 km) | 4 h 28 | −8 | −9 | **−6** |
| Aachen → München, So 15.11. (438 km) | 3 h 24 | +1 | +1 | **+1** |

(Abweichung in Minuten, negativ = Modell zu schnell. Die Werte für die drei
älteren Fahrten weichen leicht von den Tabellen oben ab, weil dort mit dem
damals aktuellen statt mit dem Baustellenstand des Fahrttags gerechnet wurde.)

Nachrechnen lässt sich jede Zeile mit `abgleich-fahrt.mjs`; das Skript holt den
Stand des Fahrttags selbst aus der Git-Historie und nimmt Koeffizienten zum
Durchprobieren als Schalter:

```bash
node routenplaner/scripts/abgleich-fahrt.mjs fahrt.gpx            # Stand des Fahrttags
node routenplaner/scripts/abgleich-fahrt.mjs fahrt.gpx --lkw 9    # anderes LKW-Gewicht
```

Einzige Ausnahme ist die Fahrt vom 6.9.: ihr Tagesstand stammt aus der Zeit vor
der Wegpunkt-Korrektur und vor der Erfassung der Wechselanzeigen. Für sie gilt
`--stand 30da8cd` (drei Tage später, erster Stand mit beidem).

Die Sonntagsfahrten bewegt die Änderung nicht – das LKW-Gewicht ist damit dort
eingestellt, wo es wirkt.

Was offen bleibt:

- **A8 München → Ulm im Feierabendverkehr** (Di ab 16:45): gefahren 131 km/h,
  gerechnet 146, gut vier Minuten zu optimistisch. Am Montagvormittag dasselbe
  Bild (135 gegen 147), am Montagabend nach 19 Uhr stimmt es (148 gegen 148).
  Drei Spuren, hoher PKW-Anteil – der Dichteterm erfasst das nicht, und zwei
  Fahrten reichen nicht, um ihn daran umzustellen. Gleiche Art Fehler wie
  Frankfurt unter Wechselanzeige.
- **Die A61 fällt wieder deutlich zurück**, und zwar rein rechnerisch: zwei
  Spuren, viel Schwerverkehr, also wirkt das höhere Gewicht dort voll. Köln →
  München, Montag 8 Uhr: A3/A9 4 h 44, A7/A8 4 h 53, A61 5 h 11 (vorher 4 h 46,
  4 h 51, 4 h 54). Das Modell rechnet auf den freien A61-Abschnitten werktags
  jetzt im Mittel 108 km/h statt 124. Gemessen ist das nicht – **die
  Werktagsfahrt über die A61 fehlt weiterhin** und ist jetzt wichtiger als vorher.
- In Baustellen wird schneller gefahren als gerechnet (real 95–106, Modell
  92–96 km/h); das macht je Fahrt höchstens zwei Minuten aus.
- Aachen → München über Karlsruhe ist keine hinterlegte Route; zugeordnet sind
  nur die Teilstücke, die sich mit Köln → München decken (438 von 653 km).

### Fahrstreifen je Kilometer statt je Zählstelle

Der LKW-Abzug hängt an der Fahrstreifenzahl – zwei Spuren wiegen zwanzigfach
gegenüber drei. Bisher kam die Zahl von der nächsten BASt-Zählstelle, die bis
zu 25 km entfernt stehen darf und nur ihren eigenen Querschnitt kennt. Jetzt
kommt sie je Kilometer aus OSM (`speedgrid.json`, Feld `spuren`); Menge und
LKW-Anteil liefert weiter die Zählstelle, deren Spurzahl ist nur noch Rückfall.

Wo beide auseinanderliegen, ist meist die Zählstelle zu weit gestreckt worden:

| Abschnitt | Zählstelle sagt | OSM sagt |
|---|---|---|
| A31 Emsland, 40 km (Zählstelle Emstunnel) | 3 | 2 |
| A3 Würzburg – Nürnberg, 20 km (AK Fürth/Erlangen) | 3 | 2 |
| A8 Albaufstieg, 14 km (Merklingen) | 3 | 2 |
| A1 Kamen – Münster, 25 km | 3 | 2 |
| A61, 53 km verteilt | 2 | 3 |
| A45 Sauerland, 49 km verteilt | 2 | 3 |

Auf den fünf aufgezeichneten Fahrten stimmen beide Quellen fast überall
überein; die Abweichungen ändern sich um höchstens eine halbe Minute (−1 / −3 /
0 / −6 / +1), und die Suche über das LKW-Gewicht zeigt dasselbe flache Minimum
wie zuvor. **Das Gewicht bleibt bei 15.** Die Umstellung ist also an den Fahrten
weder belegt noch widerlegt – sie ersetzt eine grobe Zuordnung durch eine
genauere, und sie wirkt dort, wo noch nicht gemessen wurde:

| Montag 8 Uhr, 150 km/h | vorher | jetzt |
|---|---|---|
| Köln → München über A3/A9 | 4 h 44 | 4 h 51 |
| Köln → München über A7/A8 | 4 h 53 | 4 h 54 |
| Köln → München über A61 | 5 h 10 | 5 h 11 |
| München → Norddeich über A45/A31 | 7 h 49 | 8 h 02 |

Die A3/A9 verliert ihren Vorsprung vor der A7/A8 fast ganz, weil die A3
zwischen Würzburg und Nürnberg auf 20 km nur zwei Spuren hat.

Grenzen: Eine Rasterzelle fasst beide Fahrtrichtungen zusammen. Auf Strecken
mit wechselnden Steigungsstreifen (A45) kann die Spurzahl deshalb für die
eigene Richtung falsch sein. Und OSM zählt mitunter Verflechtungsstreifen als
Spur.

## Annahmen & bekannte Grenzen

- **Stundenverteilung ist eine Modellannahme.** Die BASt liefert Tagessummen je
  Tagestyp, keine Stundenwerte. Die Verteilung über den Tag (inklusive der
  Zuschläge für Freitagnachmittag und Sonntagabend) ist eine typisierte Kurve im
  Code, keine Messung. Die Tagestypen selbst – und damit der große
  Sonntagseffekt – stammen dagegen direkt aus den Daten.
- **Richtungszuordnung der Zählstellen fehlt.** Die BASt misst richtungsgetrennt,
  aber welche der beiden Zählrichtungen der eigenen Fahrtrichtung entspricht,
  ließe sich nur über Geocoding der Fernziel-Namen bestimmen. Daher wird über
  beide Richtungen gemittelt; bei der Fahrstreifenzahl wird konservativ das
  Minimum genommen. Baustellen sind davon nicht betroffen – die werden über die
  Geometrie richtungsscharf zugeordnet.
- **Die Verkehrs-Koeffizienten sind kalibriert, nicht hergeleitet.** Sie sind so
  gewählt, dass die Referenzfahrt und die bekannte Rangfolge getroffen werden.
  Für andere Strecken können sie danebenliegen.
- **Kein Live-Verkehr.** Die BASt-Daten sind Jahresmittel, keine aktuelle
  Verkehrslage. Ein Stau von heute Mittag steckt nicht darin.
- **Der Anlagen-Anteil ist der schwächste der drei Kalibrierwerte.** Dass
  Wechselanzeigen bremsen, ist klar belegt; wie stark, hängt an einer einzigen
  Fahrt und lässt sich darin nicht sauber von der allgemeinen Verkehrsbremse
  trennen (siehe Kalibrierung). Der Anteil von 20 % ist so gewählt, dass er die
  gemessenen Anlagen-Abschnitte trifft, ohne das Gesamtbild zu verschlechtern –
  er ist plausibel, nicht bewiesen.
- **Wie oft eine Anlage schaltet, weiß OSM nicht.** Das Tag `maxspeed:variable`
  sagt nur, dass eine Anzeige existiert, nicht wann sie welchen Wert zeigt. Der
  angesetzte Schaltwert von 120 km/h ist eine Annahme.
- **Die Untergrenze von 90 km/h greift kaum noch.** Mit dem an Sonntagsdaten
  eingestellten LKW-Gewicht 60 bestimmte sie an einem Werktagvormittag bei 38 %
  der Zählstellen das Tempo statt der Rechnung. Zwei Werktagsfahrten haben das
  widerlegt (siehe Kalibrierung); mit LKW-Gewicht 15 liegt an einem
  Werktagvormittag eine von 807 Zählstellen auf der Grenze. Belegt ist der Wert
  nur für A7, A3 und A8 – **eine Werktagsfahrt über die A61** fehlt noch.
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
- **Geplante Baustellen** (`future`-Flag bzw. Beginn jenseits des 14-Tage-Horizonts)
  bleiben außen vor.
- **Zeitfenster nur, wo angegeben.** Rund ein Fünftel der Meldungen nennt konkrete
  Gültigkeitsfenster; der Rest sind Dauerbaustellen und gilt rund um die Uhr. Eine
  Meldung ohne erkennbares Fenster wird also immer eingerechnet.
- **Zwischenpunkte können Umwege erzeugen.** Liegt ein Punkt im Autobahnkreuz,
  baut OSRM eine Kehrtwende ein (siehe "Einen weiteren Korridor hinzufügen").
  Alle zwölf hinterlegten Routen sind daraufhin geprüft und bereinigt; sie waren
  zuvor zwischen 6 und 70 km zu lang. Bei neuen Routen ist das erneut zu prüfen.
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
