// Unterschiede zwischen Web-App und nativer Hülle (Capacitor, siehe ../app/) an
// einer Stelle. Die Seiten fragen hier nach, statt selbst zu prüfen, wo sie laufen.
//
//   nativ          – läuft die Seite in der Capacitor-Hülle?
//   datenBasis()   – wo liegen data/*.json? In der Hülle sind sie mit eingepackt
//                    und damit so alt wie die App. Deshalb zuerst die Live-Seite,
//                    das Eingepackte nur ohne Netz.
//   ortung         – laufende Position. Im Browser watchPosition (nur im
//                    Vordergrund), in der Hülle das Plugin für Hintergrund-Ortung.
(function () {
  const cap = window.Capacitor;
  const nativ = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());

  const LIVE = "https://marzei1977.github.io/travel_with_speed/routenplaner/";
  let basisP = null;
  // Liefert "" (neben der Seite) oder die Live-Adresse. routes.json und
  // roadworks.json gehören über Segmentnummern zusammen – deshalb eine Basis
  // für alle Dateien, nie gemischt.
  function datenBasis() {
    if (!nativ) return Promise.resolve("");
    if (basisP) return basisP;
    basisP = (async () => {
      try {
        const ab = new AbortController();
        const zeit = setTimeout(() => ab.abort(), 4000);
        const r = await fetch(LIVE + "data/junctions.json", { method: "HEAD", cache: "no-store", signal: ab.signal });
        clearTimeout(zeit);
        return r.ok ? LIVE : "";
      } catch { return ""; }
    })();
    return basisP;
  }

  // Beide Wege melden Punkte in der Form der Geolocation-API
  // ({ coords: { latitude, longitude, accuracy, altitude, speed }, timestamp }),
  // Fehler als { abgelehnt: true|false, wartet: true|false }.
  // starten() liefert eine Funktion, die die Ortung beendet.
  let plugin = null;
  const ortungsPlugin = () => plugin || (plugin = cap.registerPlugin("BackgroundGeolocation"));

  const ortung = {
    hintergrund: nativ,
    verfuegbar: nativ || "geolocation" in navigator,

    async starten(beiPunkt, beiFehler) {
      if (nativ) {
        const id = await ortungsPlugin().addWatcher({
          // Mit backgroundMessage läuft die Ortung bei gesperrtem Bildschirm weiter.
          backgroundTitle: "Linke Spur zeichnet auf",
          backgroundMessage: "Die Fahrt wird mitgeschrieben, bis du sie beendest.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        }, (ort, fehler) => {
          if (fehler) { beiFehler({ abgelehnt: fehler.code === "NOT_AUTHORIZED", wartet: false }); return; }
          if (!ort) return;
          beiPunkt({
            coords: {
              latitude: ort.latitude, longitude: ort.longitude, accuracy: ort.accuracy,
              altitude: ort.altitude, speed: ort.speed,
            },
            timestamp: ort.time || Date.now(),
          });
        });
        return () => ortungsPlugin().removeWatcher({ id }).catch(() => {});
      }
      const id = navigator.geolocation.watchPosition(beiPunkt, (err) => {
        beiFehler({ abgelehnt: err.code === err.PERMISSION_DENIED, wartet: err.code === err.TIMEOUT });
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
      return () => navigator.geolocation.clearWatch(id);
    },

    // Öffnet in der Hülle die Einstellungen der App (Standortfreigabe).
    einstellungen() {
      if (nativ) ortungsPlugin().openSettings().catch(() => {});
    },
  };

  window.LinkeSpurPlattform = { nativ, datenBasis, ortung };
})();
