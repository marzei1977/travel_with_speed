# Linke Spur als App – Plan

Stand: 15.11.2026. Ziel ist eine App im App Store, in der Nutzer ihre
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

### 2. Fahrten mitschneiden

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
  ermuntern. Die App tritt als Routenplaner nach echten Tempolimits auf, nicht
  als Werkzeug zum Schnellfahren. Bedienung während der Fahrt ist gesperrt oder
  auf Start/Stopp reduziert.

## Reihenfolge

1. Lieblingsorte in der Web-App (Baustein 1) – erledigt
2. Auswertung ausbauen (Baustein 3) – erledigt
3. Capacitor-Hülle auf dem eigenen iPhone, Hintergrund-Aufzeichnung (Baustein 2)
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
