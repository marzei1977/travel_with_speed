# Linke Spur als iPhone-App (Capacitor)

Native Hülle um die Web-App in `../routenplaner`. Sie bringt genau eines mit,
das der Browser nicht kann: **Ortung im Hintergrund** – die Aufzeichnung läuft
bei gesperrtem Bildschirm weiter.

**Stand: angelegt, aber noch nie gebaut.** Auf diesem Rechner fehlt Xcode. Das
Projekt ist erzeugt, die Web-Seiten sind vorbereitet und im Browser geprüft;
ob die App auf dem iPhone startet und im Hintergrund aufzeichnet, ist offen.

## Aufbau

- `capacitor.config.json` – Kennung `de.linkespur.app`, Web-Inhalt aus `../routenplaner`
- `ios/` – das Xcode-Projekt. `ios/App/App/Info.plist` enthält die Texte der
  Standortabfrage und den Hintergrundmodus `location`
- Plugin: `@capacitor-community/background-geolocation`
- `../routenplaner/plattform.js` – die einzige Stelle, an der die Seiten zwischen
  Browser und Hülle unterscheiden (Ortung, Datenquelle)

## Erster Bau

1. Xcode aus dem App Store installieren (rund 12 GB), einmal öffnen und die
   iOS-Plattform nachladen lassen.
2. Hier im Ordner:

   ```bash
   npm install
   npx cap sync ios
   npx cap open ios
   ```

3. In Xcode unter *Signing & Capabilities* mit der eigenen Apple-ID ein Team
   wählen. Ein kostenloses Konto genügt für das eigene iPhone; die App läuft
   dann jeweils 7 Tage.
4. iPhone anschließen, als Ziel wählen, starten. Bei der ersten Aufzeichnung
   den Standort erlauben.

## Nach jeder Änderung an der Web-App

```bash
npx cap sync ios
```

Das kopiert `../routenplaner` in die App. Die Daten (`data/*.json`) holt die App
bei jedem Start frisch von der Live-Seite und nimmt die eingepackten nur ohne Netz.

## Was beim ersten Test zu prüfen ist

- Startet die App und zeigt den Planer mit Karte?
- Führen die Links zu „Fahrt aufzeichnen" und „auswerten" auf die richtige Seite?
  (Die Hülle liefert für Adressen ohne Dateiname immer die Startseite – deshalb
  nennen alle Seitenlinks `index.html` ausdrücklich.)
- Läuft die Aufzeichnung bei gesperrtem Bildschirm lückenlos weiter? Prüfen über
  die Punktzahl und über die Auswertung der Fahrt.
- Akkuverbrauch auf einer langen Fahrt.

## Bekannte Grenzen

- Schließt iOS die App im Hintergrund ganz, endet die Aufzeichnung. Gesichert
  ist dann alles bis zur letzten vollen Minute; die Fahrt steht als
  „unvollständig beendet" in der Liste.
- Start und Stopp nur per Knopf. Automatischer Start an einem Lieblingsort fehlt.
- Name und Kennung sind vorläufig (siehe `../APP-PLAN.md`, „Name und Auftritt im Store").
