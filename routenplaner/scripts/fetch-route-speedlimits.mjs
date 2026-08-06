// Ermittelt für die in routenplaner/config/corridors.json definierten Routen die
// tatsächliche Geometrie (via OSRM-Demo-Router) und ordnet jedem Fahrbahn-Abschnitt
// das dort geltende Tempolimit aus OpenStreetMap (via Overpass-API) zu.
//
// Läuft ohne externe npm-Abhängigkeiten (Node 18+ eingebautes fetch).
// Wird nur selten ausgeführt (Tempolimits ändern sich kaum) – siehe
// .github/workflows/routenplaner-routes.yml.

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "Mozilla/5.0 (compatible; AutobahnRoutenplaner/1.0; personal project) Node.js";
const REQUEST_TIMEOUT_MS = 30_000;
const OVERPASS_TIMEOUT_MS = 90_000;
const DELAY_BETWEEN_REQUESTS_MS = 2_000;
// Fallback, wenn ein Abschnitt kein maxspeed-Tag in OSM hat: Richtgeschwindigkeit
// Autobahn. Wird in der UI als Annahme gekennzeichnet.
const DEFAULT_MAXSPEED_FALLBACK = 130;
// Wie weit ein OSM-Way maximal vom Routen-Abschnitt entfernt sein darf, um ihm noch
// zugeordnet zu werden.
const MATCH_DISTANCE_THRESHOLD_M = 5000;
// Feste Länge, in die die Route für die Tempolimit-/Baustellen-Zuordnung zerlegt
// wird. WICHTIG: OSRM-"steps" sind dafür ungeeignet, da ein einzelner Step (ohne
// Abbiegehinweis) auf der Autobahn 100+ km lang sein kann – das würde Tempolimits
// und Baustellen viel zu grob (und damit falsch) zuordnen.
const CHUNK_LENGTH_M = 1000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { "User-Agent": USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} für ${url}: ${body.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Distanz zwischen zwei {lat, lon}-Punkten in Metern (Haversine).
function haversine(a, b) {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Normalisiert eine Autobahn-Referenz für den Vergleich, z.B. "A 3" / "A3" -> "A3".
function normalizeRef(ref) {
  if (!ref) return null;
  const m = String(ref)
    .toUpperCase()
    .match(/^A\s?(\d+)$/);
  return m ? `A${m[1]}` : null;
}

async function fetchOsrmRoute(waypoints) {
  const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?steps=true&annotations=false&overview=full&geometries=geojson`;
  const data = await fetchJson(url);
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(`OSRM lieferte kein Ergebnis (${data.code}: ${data.message || ""})`);
  }
  return data.routes[0];
}

// Fasst die Rohgeometrie einer Route zu einer Bounding-Box zusammen (mit Puffer).
function boundingBoxOf(coordinates, paddingDeg = 0.15) {
  let south = 90,
    north = -90,
    west = 180,
    east = -180;
  for (const [lon, lat] of coordinates) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return {
    south: south - paddingDeg,
    west: west - paddingDeg,
    north: north + paddingDeg,
    east: east + paddingDeg,
  };
}

async function fetchOverpassWays(refs, bbox) {
  if (refs.length === 0) return [];
  const pattern = refs.map((r) => `A ?${r.slice(1)}`).join("|");
  const query = `[out:json][timeout:120];
way["highway"="motorway"]["ref"~"^(${pattern})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom;`;

  // Der öffentliche Overpass-Server ist gelegentlich überlastet (504) oder braucht bei
  // großen Bounding-Boxen >30s – daher großzügiges Timeout + ein paar Retries.
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
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
      if (!res.ok) {
        throw new Error(`Overpass HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      lastErr = err;
      console.warn(`  Overpass-Versuch ${attempt}/${maxAttempts} fehlgeschlagen: ${err.message}`);
      if (attempt < maxAttempts) await sleep(5_000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function parseMaxspeed(tags) {
  if (!tags) return null;
  const raw = tags.maxspeed;
  if (!raw) return null;
  if (raw === "none") return "none";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// Ordnet einem Streckenpunkt (Mittelpunkt eines OSRM-Steps) den nächstgelegenen
// passenden OSM-Way zu (einfache Punkt-zu-Way-Distanz über dessen Knoten).
function findNearestWay(point, ways, ref) {
  let best = null;
  let bestDist = Infinity;
  for (const way of ways) {
    if (normalizeRef(way.tags?.ref) !== ref) continue;
    if (!way.geometry?.length) continue;
    for (const node of way.geometry) {
      const d = haversine(point, { lat: node.lat, lon: node.lon });
      if (d < bestDist) {
        bestDist = d;
        best = way;
      }
    }
  }
  if (best && bestDist <= MATCH_DISTANCE_THRESHOLD_M) return best;
  return null;
}

// Cumulative Distanz (Meter) an jedem Punkt einer [lon,lat]-Polylinie.
function cumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = { lat: coords[i - 1][1], lon: coords[i - 1][0] };
    const b = { lat: coords[i][1], lon: coords[i][0] };
    cum.push(cum[i - 1] + haversine(a, b));
  }
  return cum;
}

// Interpoliert den Punkt auf der Polylinie bei einer bestimmten cumulativen Distanz.
function pointAtDistance(coords, cum, targetM) {
  if (targetM <= 0) return { lat: coords[0][1], lon: coords[0][0] };
  const last = cum.length - 1;
  if (targetM >= cum[last]) return { lat: coords[last][1], lon: coords[last][0] };
  // lineare Suche reicht hier (Polylinien sind einige tausend Punkte lang, läuft
  // nur ein paar Mal pro Route)
  let i = 1;
  while (cum[i] < targetM) i++;
  const segStart = cum[i - 1];
  const segEnd = cum[i];
  const t = segEnd > segStart ? (targetM - segStart) / (segEnd - segStart) : 0;
  const a = coords[i - 1];
  const b = coords[i];
  return { lat: a[1] + (b[1] - a[1]) * t, lon: a[0] + (b[0] - a[0]) * t };
}

// Baut aus den OSRM-Steps eine Liste von cumulativen Distanz-Intervallen mit der
// jeweils geltenden Straßenreferenz/-name/Durchschnittstempo, damit jedem Chunk der
// Route (siehe unten) die richtige Straße zugeordnet werden kann.
function buildStepIntervals(steps) {
  const intervals = [];
  let cum = 0;
  for (const step of steps) {
    const from = cum;
    const to = cum + step.distance;
    intervals.push({
      from,
      to,
      ref: normalizeRef(step.ref),
      name: step.name || null,
      avgSpeedKmh: step.duration > 0 ? (step.distance / 1000) / (step.duration / 3600) : null,
    });
    cum = to;
  }
  return intervals;
}

function stepIntervalAt(intervals, distM) {
  for (const iv of intervals) {
    if (distM >= iv.from && distM <= iv.to) return iv;
  }
  return intervals[intervals.length - 1] || null;
}

async function buildRoute(routeConfig, waypoints) {
  const osrmRoute = await fetchOsrmRoute(waypoints);
  const steps = osrmRoute.legs.flatMap((leg) => leg.steps);
  const stepIntervals = buildStepIntervals(steps);

  const refs = [...new Set(steps.map((s) => normalizeRef(s.ref)).filter(Boolean))];
  const bbox = boundingBoxOf(osrmRoute.geometry.coordinates);

  await sleep(DELAY_BETWEEN_REQUESTS_MS);
  const ways = await fetchOverpassWays(refs, bbox);

  const coords = osrmRoute.geometry.coordinates;
  const cum = cumulativeDistances(coords);
  const totalM = cum[cum.length - 1];
  const numChunks = Math.max(1, Math.ceil(totalM / CHUNK_LENGTH_M));

  const segments = [];
  for (let k = 0; k < numChunks; k++) {
    const from = k * CHUNK_LENGTH_M;
    const to = Math.min((k + 1) * CHUNK_LENGTH_M, totalM);
    if (to <= from) continue;
    const start = pointAtDistance(coords, cum, from);
    const end = pointAtDistance(coords, cum, to);
    const mid = pointAtDistance(coords, cum, (from + to) / 2);

    const stepInfo = stepIntervalAt(stepIntervals, (from + to) / 2);
    const ref = stepInfo?.ref || null;

    let maxspeedTag = null;
    if (ref) {
      const way = findNearestWay(mid, ways, ref);
      maxspeedTag = way ? parseMaxspeed(way.tags) : null;
    }

    // fallbackSpeedKmh greift nur, wenn maxspeedTag null ist (kein OSM-Tag
    // gefunden): auf einer erkannten Autobahn ohne Tag wird die
    // Richtgeschwindigkeit angenommen; auf sonstigen Straßen (Zubringer,
    // Ortsdurchfahrten, Landstraßen ohne Autobahn-Ref) die von OSRM anhand des
    // Straßentyps implizierte Durchschnittsgeschwindigkeit (distance/duration) –
    // sonst würde z.B. eine Ortsdurchfahrt fälschlich mit Autobahn-Tempo gerechnet.
    let fallbackSpeedKmh = null;
    if (maxspeedTag === null) {
      fallbackSpeedKmh = ref
        ? DEFAULT_MAXSPEED_FALLBACK
        : Math.round(stepInfo?.avgSpeedKmh || 50);
    }

    segments.push({
      ref,
      name: stepInfo?.name || null,
      distanceMeters: Math.round(to - from),
      maxspeedTag, // number | "none" | null = kein OSM-Tag gefunden
      fallbackSpeedKmh, // nur gesetzt wenn maxspeedTag null ist, siehe oben
      start,
      end,
    });
  }

  return {
    id: routeConfig.id,
    label: routeConfig.label,
    distanceMeters: Math.round(osrmRoute.distance),
    durationOsrmSeconds: Math.round(osrmRoute.duration),
    segments,
  };
}

async function main() {
  const configRaw = await readFile(
    new URL("../config/corridors.json", import.meta.url),
    "utf-8"
  );
  const config = JSON.parse(configRaw);

  const corridors = [];
  for (const corridor of config.corridors) {
    const routes = [];
    for (const routeConfig of corridor.routes) {
      console.log(`Verarbeite ${corridor.name} – ${routeConfig.label} …`);
      // Wegpunkte werden aus der zentralen punkte-Tabelle aufgelöst, damit
      // Hin- und Rückrichtung garantiert dieselben Koordinaten benutzen.
      const waypoints = routeConfig.via.map((key) => {
        const p = config.punkte[key];
        if (!p) throw new Error(`Unbekannter Wegpunkt "${key}" in ${corridor.id}/${routeConfig.id}`);
        return p;
      });
      try {
        routes.push(await buildRoute(routeConfig, waypoints));
      } catch (err) {
        console.error(`  Fehler: ${err.message}`);
        routes.push({
          id: routeConfig.id,
          label: routeConfig.label,
          error: err.message,
          segments: [],
        });
      }
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
    corridors.push({
      id: corridor.id,
      name: corridor.name,
      von: corridor.von,
      nach: corridor.nach,
      routes,
    });
  }

  const output = {
    updatedAt: new Date().toISOString(),
    corridors,
  };

  await writeFile(
    new URL("../data/routes.json", import.meta.url),
    JSON.stringify(output, null, 2) + "\n",
    "utf-8"
  );

  console.log("routes.json geschrieben.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
