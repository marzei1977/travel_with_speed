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

Warum der LKW-Anteil so stark eingeht: auf einer zweispurigen Richtungsfahrbahn
blockiert ein überholender LKW beide Fahrstreifen, ab drei Spuren bleibt links
meist Platz. Die BASt-Daten zeigen das deutlich – die A61 hat mit im Mittel 2,1
Fahrstreifen die wenigsten und mit rund 20 % den höchsten Schwerverkehrsanteil,
die A9 dagegen 3,1 Spuren bei rund 13 %.

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
(+ 4 min Halt), Ø 120 km/h.

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

Ohne Verkehrsfaktor liegt die A61-Route zeitlich knapp vorn, obwohl der
A61-Abschnitt selbst nur zu rund einem Drittel unbegrenzt ist – sie kompensiert
das über einen langen, fast durchgehend unbegrenzten A8-Abschnitt und weniger
Stadtanteil. Erst das Verkehrsaufkommen (zwei Spuren, hoher LKW-Anteil) dreht
die Reihenfolge um. Die Praxiserfahrung wird also vom Verkehrsmodell abgebildet,
nicht von den Tempolimits allein.

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
- **Die Untergrenze von 90 km/h ist der schwächste Punkt des Verkehrsmodells.**
  Wo der Abzug groß wird, bestimmt nicht mehr die Rechnung das Tempo, sondern
  diese Zahl. An einem Werktagvormittag betrifft das jetzt 29 % der geprüften
  Zählstellen – vor der Verstärkung des Fahrstreifen-Effekts waren es 13 %.
  Betroffen sind fast nur zweispurige, LKW-reiche Strecken (A38, A6, A45, A93,
  A31), also genau die, die der Effekt treffen soll; auf den Hauptachsen A3 und
  A9 rechnet das Modell dafür deutlich weniger falsche Bremsung (A3 werktags
  116 → 129 km/h). Eine weiche Sättigung statt der harten Kappung wäre die
  saubere Lösung – sie würde die A61 werktags von 90 auf 112 km/h heben. Dafür
  fehlt aber die Messung: die vorhandene Fahrt war ein Sonntag mit wenig Verkehr.
  **Nächster sinnvoller Schritt ist eine GPX-Aufzeichnung an einem Werktag**,
  gern auf der A61.
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
