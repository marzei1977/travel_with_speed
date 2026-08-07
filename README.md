# travel_with_speed

Routenplanung für deutsche Autobahnen, die sich an den **tatsächlichen
Tempolimits** und der eigenen Wunschgeschwindigkeit orientiert – nicht am
statistischen Durchschnittstempo.

Übliche Routenplaner empfehlen oft die kürzeste oder rechnerisch schnellste
Strecke. Die kann aber über weite Teile tempolimitiert und zweispurig sein,
während eine etwas längere Alternative überwiegend unbegrenzt und dreispurig
verläuft – und für zügige Fahrer in der Praxis früher ankommt.

**→ [Zum Routenplaner](routenplaner/)** · Details, Datenquellen und die Grenzen
der Schätzung stehen in [routenplaner/README.md](routenplaner/README.md).

## Was einfließt

| Quelle | Wofür |
|---|---|
| OpenStreetMap (Overpass) | Tempolimits je Abschnitt, inkl. „unbegrenzt" |
| OSRM | Routenverlauf |
| Autobahn GmbH des Bundes | Baustellen und Sperrungen, inkl. Gültigkeitszeiten |
| BASt-Dauerzählstellen | Verkehrsstärke, LKW-Anteil, Fahrstreifenzahl |

Die Seite ist statisch und rechnet im Browser. Die Daten hält ein GitHub-Actions-
Cronjob aktuell: Baustellen alle 30 Minuten, Tempolimits wöchentlich,
Verkehrsdaten monatlich.

## Einrichtung

Damit die Cronjobs ihre Ergebnisse zurückschreiben dürfen, muss unter
**Settings → Actions → General → Workflow permissions** die Option
„Read and write permissions" aktiv sein. Die Webseite wird über
**Settings → Pages** aus dem Branch `main`, Ordner `/ (root)` veröffentlicht.
