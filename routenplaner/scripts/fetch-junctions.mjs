// Holt alle Autobahnkreuze und -dreiecke aus OpenStreetMap.
//
// Wozu: Für frei gewählte Start-/Zielpunkte muss der Planer selbst
// Routenalternativen erzeugen. OSRM liefert von sich aus nur zwei bis drei
// Vorschläge, und es bewertet sie nach seiner eigenen Fahrzeitschätzung, die bei
// rund 110 km/h gedeckelt ist – der Unterschied zwischen einem unbegrenzten und
// einem auf 130 begrenzten Abschnitt existiert dort nicht. Zusätzliche Kandidaten
// entstehen, indem dieselbe Strecke über verschiedene Kreuze erzwungen wird.
//
// Läuft selten (Kreuze ändern sich kaum) – siehe
// .github/workflows/routenplaner-junctions.yml.

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// Schlichte Kennung – Overpass weist browserartige User-Agents mit HTTP 406 ab.
const USER_AGENT = "AutobahnRoutenplaner/1.0 (privates Projekt)";
const TIMEOUT_MS = 300_000;
// Deutschland grob umschlossen.
const BBOX = "47.2,5.8,55.1,15.1";

const QUERY = `[out:json][timeout:180];
node["highway"="motorway_junction"]["name"~"Kreuz|Dreieck",i](${BBOX});
out body;`;

// Was die Abfrage nicht leisten kann, erledigt ein Filter hinterher gegen das
// Tempolimit-Raster: Es enthält jede Autobahn-Rasterzelle Deutschlands, der
// Abgleich kostet keine einzige weitere Anfrage.
//
// Nötig ist er, weil "highway=motorway_junction" auch an autobahnähnlichen
// Bundesstraßen steht und der Namensfilter Teilwörter erwischt. Das "Aalener
// Dreieck" ist in Wahrheit der B29a/B19-Knoten; als erzwungener Zwischenpunkt
// schickte er eine Route von der A7 herunter und quer durch Aalen – 38 km Umweg
// über Industrie- und Burgstallstraße. "Kreuztal" wiederum ist eine Stadt bei
// Siegen. Von 336 Einträgen lagen so 25 nicht einmal in der Nähe einer Autobahn.
const MAX_ABSTAND_M = 600;

// Der Namensfilter der Abfrage kennt keine Wortgrenzen und erwischt deshalb
// alles, was "Kreuz" irgendwo im Namen trägt: "Kreuztal" (eine Stadt bei
// Siegen), "Rastplatz Kreuzfeld", "Kreuzung". Ein echtes Kreuz heißt entweder
// so oder trägt es am Wortende – Nordkreuz, Autobahnkreuz, Autobahndreieck.
// Semikolon und Schrägstrich trennen in OSM Mehrfachnamen ("Mönchhof-Dreieck;
// Raunheim") – ohne sie als Wortgrenze zu nehmen, fielen echte Dreiecke heraus.
const istKreuzName = (name) =>
  name.split(/[\s;,/-]+/).some((w) => /(kreuz|dreieck)$/i.test(w)) &&
  !/rastplatz|rasthof|parkplatz|kreuzung/i.test(name);

async function autobahnPruefer() {
  let grid;
  try {
    grid = JSON.parse(await readFile(new URL("../data/speedgrid.json", import.meta.url), "utf-8"));
  } catch {
    console.warn("  speedgrid.json nicht lesbar – ohne Autobahn-Prüfung weiter.");
    return null;
  }
  const zellen = new Map();
  for (const [ref, flat] of Object.entries(grid.refs)) {
    let la = 0, lo = 0;
    for (let i = 0; i < flat.length; i += 3) {
      la += flat[i]; lo += flat[i + 1];
      const key = `${la}|${lo}`;
      if (!zellen.has(key)) zellen.set(key, []);
      zellen.get(key).push({ ref, lat: la / grid.grid, lon: lo / grid.grid });
    }
  }
  return (p) => {
    const la = Math.round(p.lat * grid.grid), lo = Math.round(p.lon * grid.grid);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++)
      for (const z of zellen.get(`${la + a}|${lo + b}`) || [])
        if (haversineKm(p, z) * 1000 <= MAX_ABSTAND_M) return z.ref;
    return null;
  };
}

async function overpass(query) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      lastErr = err;
      console.warn(`  Versuch ${attempt}/${maxAttempts} fehlgeschlagen: ${err.message}`);
      if (attempt < maxAttempts) await sleep(5_000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function toRad(d) {
  return (d * Math.PI) / 180;
}
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function main() {
  const pruefer = await autobahnPruefer();

  // --nur-filtern wendet die Autobahn-Prüfung auf die vorhandene Datei an, ohne
  // Overpass zu behelligen. Nützlich, wenn der Server gerade dichtmacht – oder
  // nachdem der Filter geändert wurde.
  if (process.argv.includes("--nur-filtern")) {
    if (!pruefer) throw new Error("Ohne speedgrid.json lässt sich nicht filtern.");
    const vorhanden = JSON.parse(await readFile(new URL("../data/junctions.json", import.meta.url), "utf-8"));
    const gut = (k) => istKreuzName(k.name) && pruefer(k);
    const behalten = vorhanden.kreuze.filter(gut);
    const raus = vorhanden.kreuze.filter((k) => !gut(k));
    console.log(`${vorhanden.kreuze.length} Einträge geprüft, ${raus.length} verworfen:`);
    for (const r of raus)
      console.log(`  - ${r.name}${istKreuzName(r.name) ? " (keine Autobahn im Umkreis)" : " (kein Kreuzname)"}`);
    await writeFile(
      new URL("../data/junctions.json", import.meta.url),
      JSON.stringify({ ...vorhanden, updatedAt: new Date().toISOString(), kreuze: behalten }) + "\n",
      "utf-8"
    );
    console.log(`junctions.json geschrieben: ${behalten.length} Kreuze.`);
    return;
  }

  console.log("Frage Autobahnkreuze ab …");
  const nodes = await overpass(QUERY);
  console.log(`  ${nodes.length} Knoten erhalten`);

  // Jedes Kreuz besteht aus mehreren Knoten (je Fahrbahn und Rampe). Sie werden
  // über den Namen gruppiert – und zwar nur, wenn sie auch räumlich zusammen
  // liegen, denn Namen wie "Kreuz Nord" gibt es mehrfach im Land.
  const groups = new Map();
  for (const n of nodes) {
    const name = (n.tags?.name || "").trim();
    if (!name) continue;
    if (!istKreuzName(name)) continue;
    const list = groups.get(name) || [];
    const near = list.find((g) => haversineKm(g[0], n) < 15);
    if (near) near.push(n);
    else list.push([n]);
    groups.set(name, list);
  }

  const junctions = [];
  const verworfen = [];
  for (const [name, clusters] of groups) {
    for (const cluster of clusters) {
      const lat = cluster.reduce((s, n) => s + n.lat, 0) / cluster.length;
      const lon = cluster.reduce((s, n) => s + n.lon, 0) / cluster.length;
      // Nicht den Schwerpunkt nehmen, sondern den ihm nächsten echten Knoten:
      // der liegt garantiert auf der Fahrbahn. Ein Schwerpunkt kann zwischen den
      // Rampen im Grünen landen, und dann schnappt der Router ihn auf eine
      // Nebenstraße – derselbe Fehler wie früher beim Maps-Export.
      let best = cluster[0];
      let bestD = Infinity;
      for (const n of cluster) {
        const d = haversineKm({ lat, lon }, n);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      const kandidat = {
        name,
        lat: Math.round(best.lat * 1e5) / 1e5,
        lon: Math.round(best.lon * 1e5) / 1e5,
      };
      if (pruefer && !pruefer(kandidat)) {
        verworfen.push(name);
        continue;
      }
      junctions.push(kandidat);
    }
  }

  junctions.sort((a, b) => a.name.localeCompare(b.name, "de"));

  const output = {
    quelle: "OpenStreetMap (Overpass API), highway=motorway_junction mit Namen Kreuz/Dreieck",
    updatedAt: new Date().toISOString(),
    kreuze: junctions,
  };

  await writeFile(
    new URL("../data/junctions.json", import.meta.url),
    JSON.stringify(output) + "\n",
    "utf-8"
  );
  console.log(`junctions.json geschrieben: ${junctions.length} Kreuze/Dreiecke` +
    (verworfen.length ? `, ${verworfen.length} ohne Autobahn verworfen: ${verworfen.join(", ")}` : "") + ".");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
