# Linke Spur als App – Plan

Stand: 16.11.2026. Ziel ist eine App im App Store, in der Nutzer ihre
Lieblingsstrecken speichern, Fahrten mitschneiden und auswerten und – wenn sie
zustimmen – anonymisierte Fahrdaten spenden, mit denen das Modell laufend
besser wird.

## Zwei Punkte, die den Plan prägen

**„Anonymisiert" geht mit rohen GPS-Spuren nicht.** Eine Spur von Haustür zu
Haustür identifiziert eine Person, auch ohne Namen, und sie zeigt Tempo über
Limits. Übertragen werden deshalb nie Spuren, sondern nur Autobahnkilometer mit
Tempo – genau das, was die Kalibrierung braucht.

**„Standardmäßig an" geht nicht als vorangekreuzte Option.** Standortdaten
brauchen eine aktive Einwilligung (DSGVO), Apple verlangt dasselbe. Machbar ist
ein Einrichtungsbildschirm beim ersten Start, der die Spende klar empfiehlt und
eine bewusste Wahl verlangt.

## Bausteine

### 1. Lieblingsorte und Lieblingsstrecken – *in der Web-App umgesetzt*

- Orte speichern (Name, Koordinate), Start/Ziel-Paare als Strecke.
- Lokal auf dem Gerät, kein Konto.
- Auswahl per Tipp statt Eingabe; danach läuft die freie Suche wie bisher.

### 2. Fahrten mitschneiden – *vorbereitet, noch nie gebaut*

- **Stand 16.11.2026:** Das Capacitor-Projekt liegt in `app/`, der Tracker nutzt
  in der Hülle das Plugin für Hintergrund-Ortung, die Daten kommen dort von der
  Live-Seite. Im Browser geprüft; **auf einem iPhone noch nicht gelaufen**, weil
  Xcode fehlt. Bauanleitung und Prüfliste: `app/README.md`.

- Der Tracker existiert als Webseite (`routenplaner/aufzeichnen/`), bekommt im
  Hintergrund aber keinen Standort. Für die Aufzeichnung bei gesperrtem
  Bildschirm braucht es die native Hülle.
- Weg: Capacitor um die bestehende Web-App, dazu ein Plugin für
  Hintergrund-Ortung. Der Code der Seiten bleibt weitgehend derselbe.
- Start und Stopp zunächst per Knopf; später automatisch, wenn die Fahrt an
  einem Lieblingsort beginnt.
- Voraussetzungen: Xcode (fehlt bisher), Apple-Entwicklerkonto (99 $/Jahr).

### 3. Grafische Auswertung – *in der Web-App umgesetzt*

- Karte der Fahrt, nach Tempo eingefärbt, Kennzahlen, Kilometertabelle und
  Vergleich gespeicherter Fahrten: gibt es schon (`routenplaner/fahrt/`).
- Tempoprofil über die Strecke mit Limits und Halten.
- „Vorhergesagt gegen gefahren" je Autobahn und Streckenart – im Browser, ohne
  Baustellen (die des Fahrttags kennt nur `abgleich-fahrt.mjs`).
- Verlauf: dieselbe Strecke über mehrere Fahrten, nach Wochentag und Uhrzeit.

### 4. Datenspende

- **Was übertragen wird:** je Autobahnkilometer Autobahn, Rasterzelle, Tempo,
  Wochentag und Stunde.
- **Was nicht:** Stadtanteile, Start und Ziel, Halte, das genaue Datum, jede
  Gerätekennung.
- **Zusätzlicher Schutz:** die ersten und letzten Autobahnkilometer abschneiden;
  jede Fahrt unter einer Zufallskennung, die nicht mit anderen verknüpft ist.
- **Wohin:** GitHub Pages kann nichts empfangen. Nötig ist ein kleiner
  Empfangsdienst mit Speicher in der EU (z. B. Cloudflare Worker mit Datenbank).
- **Wofür:** die Kilometer laufen in dieselbe Abgleichsrechnung wie die fünf
  eigenen Fahrten. Damit lassen sich Strecken prüfen, die bisher fehlen
  (A61 werktags, A45, A31, A3 Würzburg – Nürnberg).
- **In der App:** Einwilligung beim ersten Start, jederzeit abschaltbar,
  Vorschau „das wird gesendet" je Fahrt.

### 5. App Store

- Datenschutzerklärung und Impressum, Apples Datenschutzangaben, Begründung für
  die Hintergrund-Ortung.
- Erst TestFlight mit wenigen Testern, dann Einreichung.
- **Risiko bei der Prüfung:** Apple lehnt Apps ab, die zu riskantem Fahren
  ermuntern. Name, Texte und nötige Änderungen stehen unter „Name und Auftritt
  im Store".

## Recht und Dienste

Einschätzung aus dem Code und den bekannten Nutzungsbedingungen, keine
Rechtsberatung. Vor dem Verkauf prüft das ein Anwalt für IT-Recht.

### Dienste, die vor dem Verkauf ersetzt werden müssen

Die App ruft drei kostenlose Gemeinschaftsdienste direkt vom Gerät auf. Sie
dulden private Nutzung, keine verkaufte App. Das Risiko ist weniger eine
Abmahnung als eine Sperre ohne Vorwarnung.

| Dienst | Wofür | Ersatz |
|---|---|---|
| `router.project-osrm.org` | Routen der freien Suche | eigener OSRM-Server oder bezahlter Routing-Anbieter |
| `tile.openstreetmap.org` | Kartenbild | bezahlter Kachel-Anbieter (MapTiler, Stadia, Thunderforest) |
| `photon.komoot.io` | Ortssuche | eigener Photon-Server oder bezahlter Geocoder |

Grobe laufende Kosten: 20 bis 100 € im Monat, je nach Nutzerzahl. Overpass ist
unkritisch, weil nur die Skripte es abfragen, nicht die Nutzer.

### Daten

- **OpenStreetMap** (Tempolimits, Fahrstreifen, Kreuze): Verkauf erlaubt.
  Quellenhinweis „© OpenStreetMap-Mitwirkende" auf der Karte und in einem
  Info-Menü. Das abgeleitete Raster (`speedgrid.json`) muss auf Anfrage unter
  ODbL herausgegeben werden; App-Code und Modell nicht.
- **Autobahn GmbH** (Baustellen, Sperrungen): **ungeklärt.** Die Schnittstelle
  ist öffentlich, eine Lizenz für kommerzielle Nutzung ist nicht bekannt.
  Klären über die Mobilithek des Bundes (Lizenz je Datensatz) oder schriftlich
  bei der Autobahn GmbH. Zuerst erledigen: ohne diese Daten fehlt ein Kernstück.
- **BASt-Zählstellen:** offen veröffentlicht, vermutlich mit Pflicht zur
  Quellenangabe. Genaue Lizenz noch nachprüfen.
- **Leaflet:** BSD-Lizenz, Lizenztext beilegen.
- **Google-Maps-Link:** nur ein Link, unproblematisch.

### Pflichten als Anbieter

- Datenschutzerklärung, Apples Datenschutzangaben, aktive Einwilligung für die
  Datenspende, Verträge zur Auftragsverarbeitung mit den Ersatzdiensten.
- Impressum mit ladungsfähiger Anschrift, Gewerbe, Umsatzsteuer. Apple zeigt
  Anschrift und Kontakt von EU-Händlern öffentlich im Store.
- Nutzungsbedingungen mit dem Hinweis, dass die Beschilderung vor Ort gilt und
  die Daten ohne Gewähr sind. Ganz ausschließen lässt sich die Haftung
  gegenüber Verbrauchern nicht.
- Markenrecherche zum Namen beim DPMA (kostenlos), noch nicht gemacht.

## Name und Auftritt im Store

Apple lehnt Apps ab, die zu riskantem Fahren ermuntern. Geprüft werden vor
allem Beschreibung, Bildschirmfotos und das, was die App tut – der Name allein
entscheidet selten. Die Linie: Die App verspricht **eine Ankunftszeit, die
stimmt**, und **die entspanntere Strecke**. Sie verspricht nicht, schneller zu
sein als andere.

### Namensvorschläge

| Name | Wirkung | Einschätzung |
|---|---|---|
| **Freie Bahn** | Redewendung, sofort verstanden, positiv | Empfehlung. Sagt, worum es geht (freie Strecke), ohne Tempo zu nennen. Sehr gebräuchlich, deshalb Marke zuerst prüfen. |
| **Bahnfrei** | dasselbe als ein Wort, eigenständiger | Ausweichname, falls „Freie Bahn" vergeben ist. |
| **Dreispurig** | trocken, Kennerwort | Unverwechselbar und greift ein echtes Merkmal der App auf. Erklärt sich Neulingen weniger. |
| **Läuft.** | locker, umgangssprachlich | Sympathisch, aber schwer zu finden und zu schützen. |
| **Durchzug** | Autofahrerwort für Kraft aus dem Drehzahlkeller | Cool für Kenner, für alle anderen ein Luftzug. |
| **Linke Spur** | der heutige Name, frech | Steht für die Überholspur und damit für Tempo. Mit sachlichem Untertitel vertretbar, aber der Name mit dem größten Prüfrisiko. |

Nicht verwenden: alles mit Vollgas, Rasen, Bleifuß, Lichthupe, Tempo-Zahlen im
Namen. „Tempomat" ist eine Marke von Mercedes-Benz.

### Texte für den Store (Entwurf, Name „Freie Bahn")

**Untertitel** (höchstens 30 Zeichen): `Ankunftszeit, die stimmt`

**Werbetext** (höchstens 170 Zeichen):
> Welche Autobahn ist heute wirklich die beste? Freie Bahn rechnet mit echten
> Tempolimits, Baustellen und Fahrstreifen – Kilometer für Kilometer.

**Beschreibung:**
> Navis rechnen mit Durchschnittswerten. Freie Bahn schaut genau hin.
>
> Für jede Route durch Deutschland weiß die App Kilometer für Kilometer, was
> dort gilt: Tempolimit oder frei, zwei Spuren oder drei, Baustelle oder nicht.
> Daraus entsteht eine Ankunftszeit, auf die du dich verlassen kannst – und oft
> eine Strecke, an die dein Navi nicht gedacht hat.
>
> EHRLICH VERGLEICHEN
> Mehrere Routen nebeneinander, mit Fahrzeit, Anteil freier Strecke, Anteil
> dreispuriger Strecke und allen Baustellen samt Sperrungen von heute.
>
> ENTSPANNTER ANKOMMEN
> Drei Spuren und wenig Baustellen fahren sich besser als die kürzeste Linie
> auf der Karte. Sortiere nach dem, was dir wichtig ist.
>
> DEINE STRECKEN
> Lieblingsorte und Lieblingsstrecken mit einem Tipp. Kein Konto, keine Anmeldung.
>
> DEINE FAHRTEN
> Zeichne eine Fahrt auf und sieh danach, wie sie lief: Tempoprofil, Halte und
> der Vergleich mit der Vorhersage. Dieselbe Strecke am Montag und am Sonntag
> nebeneinander.
>
> DEINE DATEN
> Alles bleibt auf deinem Gerät. Wenn du magst, hilfst du mit anonymen
> Autobahnkilometern, die Vorhersage für alle besser zu machen – nur mit deiner
> ausdrücklichen Zustimmung.
>
> Es gelten immer die Beschilderung vor Ort und die Straßenverkehrsordnung.
> Bitte bediene die App nicht während der Fahrt.

**Stichwörter:** Autobahn, Route, Routenplaner, Tempolimit, Baustelle, Stau,
Sperrung, Ankunftszeit, Fahrzeit, Fahrtenbuch, GPS

### Was dafür in der App anders sein muss

- **Kein Durchschnitt 147 km/h, kein „für Leute, die zügig fahren"** in
  Beschreibung, Bildschirmfotos und `manifest.webmanifest`.
- **„Wunschgeschwindigkeit" heißt „Reisetempo auf freier Strecke"**, Vorgabe in
  der Store-Fassung 130 (Richtgeschwindigkeit) statt 150. Verstellbar bleibt es.
- **Bildschirmfotos mit Reisetempo 130.**
- **Die Auswertung stellt Tempo über dem Limit nicht als Leistung dar** – keine
  Bestwerte, keine Ranglisten, kein Spitzentempo als Kennzahl.
- **Während der Fahrt** zeigt der Tracker nur Start/Stopp und Status.
- **Keine Blitzer, keine Kontrollen** – heute nicht enthalten, so soll es bleiben.

## Reihenfolge

1. Lieblingsorte in der Web-App (Baustein 1) – erledigt
2. Auswertung ausbauen (Baustein 3) – erledigt
3. Capacitor-Hülle auf dem eigenen iPhone, Hintergrund-Aufzeichnung (Baustein 2)
   – Projekt angelegt; offen: Xcode installieren, bauen, auf einer Fahrt testen
4. Empfangsdienst und Datenspende (Baustein 4), zuerst nur mit eigenen Fahrten
5. TestFlight, dann Store (Baustein 5)

## Offene Entscheidungen

- **Nur iPhone oder auch Android?** Capacitor kann beides; Android verdoppelt
  Test- und Store-Aufwand.
- **Wer ist Empfänger der Daten?** Die Datenschutzerklärung braucht einen
  benannten Verantwortlichen.
- **Kostenlos oder bezahlt?** Beeinflusst, wie viele Nutzer und damit Daten
  zusammenkommen.
- **Konten ja oder nein?** Ohne Konto bleibt alles auf dem Gerät und die Spende
  ist glaubwürdig anonym; mit Konto gäbe es Synchronisation, aber deutlich mehr
  Datenschutzaufwand. Empfehlung: ohne Konto starten.
