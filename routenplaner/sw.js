// Service Worker für "Linke Spur".
//
// Aufgeteilt in drei Sorten von Anfragen, weil sie ganz verschiedene Ansprüche
// haben:
//
//   App-Shell  – die beiden Seiten, Leaflet, Icons. Klein und selten geändert,
//                deshalb beim Installieren vollständig in den Cache.
//   Daten      – data/*.json, zusammen rund 6 MB. Zu groß, um sie einem
//                Erstbesucher ungefragt aufzuladen: erst aus dem Cache
//                antworten, dann im Hintergrund erneuern. Wer die App bewusst
//                offline nutzen will, lädt sie über den Knopf in der Seite.
//   Karten     – Kacheln von OpenStreetMap. Begrenzt gecacht, damit die zuletzt
//                betrachtete Karte offline noch etwas zeigt.
//
// Alles Übrige (OSRM, Photon, die Autobahn-API) läuft ausschließlich über das
// Netz – veraltete Baustellenmeldungen wären schlimmer als gar keine.

const VERSION = "v5";
const SHELL_CACHE = `linke-spur-shell-${VERSION}`;
const DATEN_CACHE = `linke-spur-daten-${VERSION}`;
const KACHEL_CACHE = `linke-spur-kacheln-${VERSION}`;
const KACHEL_MAX = 400;

const SHELL = [
  "./",
  "./index.html",
  "./fahrt/",
  "./fahrt/index.html",
  "./aufzeichnen/",
  "./aufzeichnen/index.html",
  "./manifest.webmanifest",
  // Die Korridordefinitionen liegen neben data/ und wurden deshalb leicht
  // übersehen – ohne sie kennt die Seite offline keine einzige Strecke.
  "./config/corridors.json",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

const DATEN = [
  "./data/routes.json",
  "./data/roadworks.json",
  "./data/speedgrid.json",
  "./data/traffic.json",
  "./data/junctions.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Einzeln statt addAll: eine fehlende Datei soll nicht die ganze
    // Installation scheitern lassen.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const behalten = [SHELL_CACHE, DATEN_CACHE, KACHEL_CACHE];
    for (const name of await caches.keys())
      if (name.startsWith("linke-spur-") && !behalten.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

// Auf Zuruf der Seite: alle Daten holen, damit die App wirklich offline läuft.
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") return self.skipWaiting();
  if (e.data !== "daten-vorladen") return;
  e.waitUntil((async () => {
    const cache = await caches.open(DATEN_CACHE);
    let fertig = 0;
    for (const url of DATEN) {
      try {
        const res = await fetch(new Request(url, { cache: "reload" }));
        if (res.ok) await cache.put(url, res.clone());
      } catch { /* offline oder Server weg – dann eben beim nächsten Mal */ }
      fertig++;
      const clients = await self.clients.matchAll();
      for (const c of clients) c.postMessage({ typ: "vorladen", fertig, gesamt: DATEN.length });
    }
  })());
});

const istDaten = (u) => u.pathname.includes("/data/") && u.pathname.endsWith(".json");
const istKachel = (u) => /(^|\.)tile\.openstreetmap\.org$/.test(u.hostname);

// Cache klein halten: älteste Einträge zuerst raus.
async function begrenzen(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Daten: sofort aus dem Cache, parallel erneuern.
  if (istDaten(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATEN_CACHE);
      const treffer = await cache.match(request);
      const netz = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return treffer || (await netz) || new Response('{"error":"offline"}',
        { status: 503, headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // Kartenkacheln: erst Netz, sonst was noch da ist.
  if (istKachel(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(KACHEL_CACHE);
      try {
        const res = await fetch(request);
        if (res.ok) { await cache.put(request, res.clone()); begrenzen(KACHEL_CACHE, KACHEL_MAX); }
        return res;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Fremde Hosts (OSRM, Photon, Autobahn-API): nur Netz.
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: erst das Netz, dann der Cache. Andersherum sieht man
  // Änderungen an der Seite erst beim übernächsten Start – das hat beim
  // Entwickeln prompt zugeschlagen und wäre auch im Betrieb lästig.
  if (request.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match("./index.html")) || (await cache.match("./")) ||
          new Response("Offline und nichts im Zwischenspeicher.", { status: 503 });
      }
    })());
    return;
  }

  // Alles andere aus der Shell – Leaflet, Icons, corridors.json – ändert sich
  // nur mit einer neuen Fassung: Cache zuerst, im Hintergrund auffrischen.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const treffer = await cache.match(request, { ignoreSearch: true });
    const netz = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);
    if (treffer) return treffer;
    const res = await netz;
    if (res) return res;
    return new Response("", { status: 504 });
  })());
});
