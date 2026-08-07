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

import { writeFile } from "node:fs/promises";
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
    // "Kreuzung" ist eine gewöhnliche Straßenkreuzung, kein Autobahnkreuz –
    // der Namensfilter der Abfrage erwischt sie mit.
    if (/kreuzung/i.test(name)) continue;
    const list = groups.get(name) || [];
    const near = list.find((g) => haversineKm(g[0], n) < 15);
    if (near) near.push(n);
    else list.push([n]);
    groups.set(name, list);
  }

  const junctions = [];
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
      junctions.push({
        name,
        lat: Math.round(best.lat * 1e5) / 1e5,
        lon: Math.round(best.lon * 1e5) / 1e5,
      });
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
  console.log(`junctions.json geschrieben: ${junctions.length} Kreuze/Dreiecke.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
