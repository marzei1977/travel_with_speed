// Baut ein bundesweites Raster der Autobahn-Tempolimits aus OpenStreetMap.
//
// Wozu: Bei frei gewählten Start-/Zielpunkten steht die Route erst im Browser
// fest. Eine Overpass-Abfrage je Route dauert dort rund 30 Sekunden und wäre
// gegenüber dem öffentlichen Dienst auch nicht vertretbar. Stattdessen werden die
// Limits einmalig für ganz Deutschland vorberechnet und als kompaktes Raster
// ausgeliefert – rund 30 KB gzip für alle 138 Autobahnen.
//
// Genauigkeit: gegen die exakte Nearest-Way-Zuordnung geprüft, rund 91-93 %
// identische Segmente; der ausschlaggebende unbegrenzt-Anteil einer Route stimmt
// auf ein bis zwei Prozentpunkte.
//
// Läuft selten (Tempolimits ändern sich kaum) – siehe
// .github/workflows/routenplaner-speedgrid.yml.

import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "AutobahnRoutenplaner/1.0 (privates Projekt)";
const TIMEOUT_MS = 600_000;
const BBOX = "47.2,5.8,55.1,15.1";

// 0.005° entspricht rund 550 m in der Breite. Feiner bringt kaum Genauigkeit,
// verdoppelt aber die Dateigröße.
const GRID = 200;

const QUERY = `[out:json][timeout:540];
way["highway"="motorway"]["ref"~"^A ?[0-9]+$"](${BBOX});
out geom;`;

async function overpass(query) {
  const maxAttempts = 4;
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
      return (await res.json()).elements || [];
    } catch (err) {
      lastErr = err;
      console.warn(`  Versuch ${attempt}/${maxAttempts} fehlgeschlagen: ${err.message}`);
      if (attempt < maxAttempts) await sleep(15_000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function normalizeRef(ref) {
  const m = String(ref || "").toUpperCase().match(/^A\s?(\d+)$/);
  return m ? `A${m[1]}` : null;
}

// 0 steht für "unbegrenzt" (maxspeed=none) – das spart gegenüber einem
// Sonderwert Platz und lässt sich im Browser einfach abfragen.
function parseMaxspeed(tags) {
  const raw = tags?.maxspeed;
  if (!raw) return null;
  if (raw === "none") return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log("Frage Autobahnen bundesweit ab (dauert einige Minuten) …");
  const ways = await overpass(QUERY);
  console.log(`  ${ways.length} Wege erhalten`);

  // Je Rasterzelle gewinnt der Wert mit den meisten Knoten. Ein einfaches
  // "strengster Wert gewinnt" wäre falsch: eine kurze Auffahrt mit Tempo 80
  // würde sonst die unbegrenzte Hauptfahrbahn in derselben Zelle überschreiben,
  // und der unbegrenzt-Anteil bräche um rund 15 Prozentpunkte ein.
  const votes = new Map();
  for (const way of ways) {
    const ref = normalizeRef(way.tags?.ref);
    if (!ref) continue;
    const ms = parseMaxspeed(way.tags);
    if (ms === null) continue;
    for (const node of way.geometry || []) {
      const key = `${ref}|${Math.round(node.lat * GRID)}|${Math.round(node.lon * GRID)}`;
      let cell = votes.get(key);
      if (!cell) votes.set(key, (cell = new Map()));
      cell.set(ms, (cell.get(ms) || 0) + 1);
    }
  }

  const byRef = new Map();
  for (const [key, cell] of votes) {
    let best = null;
    let bestCount = -1;
    for (const [ms, count] of cell) {
      if (count > bestCount) {
        bestCount = count;
        best = ms;
      }
    }
    const [ref, la, lo] = key.split("|");
    const list = byRef.get(ref) || [];
    list.push([Number(la), Number(lo), best]);
    byRef.set(ref, list);
  }

  // Delta-kodiert als flaches Zahlenfeld: deutlich kleiner als Objekte je Zelle.
  const refs = {};
  for (const [ref, list] of byRef) {
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const flat = [];
    let pLa = 0;
    let pLo = 0;
    for (const [la, lo, ms] of list) {
      flat.push(la - pLa, lo - pLo, ms);
      pLa = la;
      pLo = lo;
    }
    refs[ref] = flat;
  }

  const output = {
    quelle: "OpenStreetMap (Overpass API), highway=motorway mit maxspeed",
    updatedAt: new Date().toISOString(),
    grid: GRID,
    refs,
  };

  await writeFile(
    new URL("../data/speedgrid.json", import.meta.url),
    JSON.stringify(output) + "\n",
    "utf-8"
  );
  const zellen = [...byRef.values()].reduce((s, l) => s + l.length, 0);
  console.log(`speedgrid.json geschrieben: ${zellen} Zellen, ${Object.keys(refs).length} Autobahnen.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
