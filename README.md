# Midea Portasplit – Lagerbestand-Checker (UK)

Prüft automatisch alle 30 Minuten, ob der **Midea Portasplit** Klimaanlage bei
**B&Q** und **Screwfix** gelistet bzw. vorrätig ist, und zeigt das Ergebnis auf
einer kleinen Dashboard-Seite an.

## Wie es funktioniert

- `scripts/check-stock.mjs` durchsucht die Suchergebnisse von B&Q und Screwfix
  nach "Portasplit" und prüft bei Treffern die jeweilige Produktseite auf den
  tatsächlichen Lagerstatus (Home Delivery / Click & Collect).
- `.github/workflows/check-stock.yml` führt dieses Skript per GitHub Actions
  alle 30 Minuten aus und schreibt das Ergebnis nach `data/status.json`.
- `index.html` ist ein statisches Dashboard, das `data/status.json` lädt und
  anzeigt. Kein eigener Server nötig.

Damit läuft alles kostenlos über GitHub – auch wenn dein Rechner aus ist.

## Einrichtung (einmalig)

1. Neues GitHub-Repository erstellen (z. B. `portasplit-stock-checker`).
2. Diesen Ordner hochladen:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<dein-user>/<repo-name>.git
   git push -u origin main
   ```

3. Im Repository unter **Settings → Pages**: Source auf "Deploy from a branch",
   Branch `main`, Ordner `/ (root)` einstellen. GitHub zeigt dir danach die
   Dashboard-URL (z. B. `https://<dein-user>.github.io/<repo-name>/`).
4. Unter **Settings → Actions → General → Workflow permissions**: "Read and
   write permissions" aktivieren, damit der Cronjob `data/status.json`
   committen darf.
5. Fertig. Unter dem Tab **Actions** kannst du den Workflow auch manuell
   ("Run workflow") starten, um sofort einen ersten Check auszulösen, statt
   auf die nächste 30-Minuten-Marke zu warten.

## Anpassen

- **Prüfintervall ändern**: Cron-Ausdruck in
  `.github/workflows/check-stock.yml` anpassen (z. B. `*/15 * * * *` für alle
  15 Minuten). Zu häufig sollte es nicht sein, um die Shops nicht unnötig zu
  belasten.
- **Weitere Händler ergänzen**: In `scripts/check-stock.mjs` das `RETAILERS`-
  Array um einen Eintrag mit `key`, `name`, `base` und `searchUrl` erweitern.
  Voraussetzung ist, dass der Händler strukturierte Produktdaten
  (`application/ld+json`, Schema.org `Product`/`ItemList`) auf Such- und
  Produktseiten einbindet – das ist bei den meisten großen UK-Händlern der
  Fall.
- **Anderes Produkt suchen**: `SEARCH_TERM` und den Namensfilter
  (`/portasplit/i`) in `scripts/check-stock.mjs` anpassen.

## Hinweis

Das Skript ruft die öffentlichen Such- und Produktseiten der Händler ab, so
wie es ein Browser auch tun würde – mit Pausen zwischen den Anfragen, um die
Server nicht zu belasten. Es findet keine Anmeldung statt und es werden keine
Bestellungen ausgelöst.
