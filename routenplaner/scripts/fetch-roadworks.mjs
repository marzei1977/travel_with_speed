// Holt aktuelle Baustellen & Verkehrsmeldungen von der offiziellen Autobahn-API des
// Bundes (https://verkehr.autobahn.de) für alle Autobahnen, die in den generierten
// Routen (routenplaner/data/routes.json) vorkommen, und ordnet sie den betroffenen
// Routen-Abschnitten zu (räumliches Matching, nicht nur nach Autobahn-Nummer).
//
// Läuft häufig (alle 30 Min) – siehe .github/workflows/routenplaner-roadworks.yml.

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = "https://verkehr.autobahn.de/o/autobahn";
// Schlichte, ehrliche Kennung – kein getarnter Browser-User-Agent.
const USER_AGENT = "AutobahnRoutenplaner/1.0 (privates Projekt)";
const REQUEST_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_REQUESTS_MS = 800;
// Wie nah die tatsächliche Baustellen-/Meldungsstrecke (nicht nur ihr Startpunkt!)
// an einem Routen-Abschnitt liegen muss, um ihm zugeordnet zu werden. Eng gewählt,
// da wir die reale Geometrie der Baustelle vergleichen, nicht nur einen Einzelpunkt.
const MATCH_DISTANCE_THRESHOLD_M = 1500;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Abstand Punkt -> Strecke (a-b) in Metern, via lokaler äquirektangulärer Projektion
// (für die hier relevanten kurzen Distanzen ausreichend genau).
function pointToSegmentDistanceM(p, a, b) {
  const latRef = toRad(a.lat);
  const R = 6_371_000;
  const x = (lon) => toRad(lon) * Math.cos(latRef) * R;
  const y = (lat) => toRad(lat) * R;
  const px = x(p.lon),
    py = y(p.lat);
  const ax = x(a.lon),
    ay = y(a.lat);
  const bx = x(b.lon),
    by = y(b.lat);
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Manche Meldungen nennen die dort angeordnete Geschwindigkeitsbegrenzung explizit
// im Freitext (z.B. "Länge: 1.56 km | Max. 80 km/h | ..."). Wenn vorhanden, ist das
// präziser als die pauschale Baustellen-Annahme in der UI.
function parseSpeedLimitFromDescription(description) {
  const text = (description || []).join(" ");
  const m = text.match(/Max\.\s*(\d+)\s*km\/h/i);
  return m ? parseInt(m[1], 10) : null;
}

// Die tatsächliche Baustellenlänge steht meist im Freitext ("Länge: 2.5 km").
// Ohne sie würde ein 200-m-Baustellchen ein ganzes 1-km-Segment ausbremsen.
function parseLengthKmFromDescription(description) {
  const text = (description || []).join(" ");
  const m = text.match(/Länge:\s*([\d.,]+)\s*km/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Prüft, ob die im Freitext genannte Bauphase im relevanten Zeitraum liegt. Die API
// liefert auch weit in der Zukunft geplante Maßnahmen (rund ein Drittel aller
// Einträge) sowie abgelaufene – beide dürfen die Fahrzeit nicht belasten.
// Der Horizont ist bewusst großzügig, weil die Auswahl der konkreten Abfahrtszeit
// erst im Browser passiert (siehe timeWindows).
const PLANNING_HORIZON_DAYS = 14;

function parseIsInHorizon(description) {
  const text = (description || []).join(" ");
  const parse = (re) => {
    const m = text.match(re);
    if (!m) return null;
    const [, dd, mm, yy] = m;
    return new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
  };
  const begin = parse(/Beginn:\s*(\d{2})\.(\d{2})\.(\d{2})/);
  const end = parse(/Ende:\s*(\d{2})\.(\d{2})\.(\d{2})/);
  const now = new Date();
  const horizon = new Date(now.getTime() + PLANNING_HORIZON_DAYS * 86400_000);
  if (begin && begin > horizon) return false;
  if (end && end < now) return false;
  return true;
}

const WEEKDAYS = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3,
  donnerstag: 4, freitag: 5, samstag: 6,
};

// Viele Meldungen sind reine Tagesbaustellen ("18.08.26 von 08:00 bis 16:00 Uhr")
// oder wiederkehrende Wochentagsfenster ("Jeden Montag, Dienstag ... von 07:00 bis
// 16:00 Uhr"). Nachts und am Wochenende sind sie schlicht nicht da – deshalb werden
// die Fenster extrahiert, damit der Browser sie gegen die gewählte Abfahrtszeit
// prüfen kann. Ohne erkennbares Fenster gilt die Meldung als durchgehend aktiv.
function parseTimeWindows(description) {
  const lines = description || [];
  const text = lines.join("\n");
  const windows = [];

  // Konkrete Einzeltage: "18.08.26 von 08:00 bis 16:00 Uhr"
  const dayRe = /(\d{2})\.(\d{2})\.(\d{2})\s+von\s+(\d{2}):(\d{2})\s+bis\s+(\d{2}):(\d{2})\s+Uhr/g;
  let m;
  while ((m = dayRe.exec(text)) !== null) {
    const [, dd, mm, yy, h1, min1, h2, min2] = m;
    windows.push({
      art: "datum",
      datum: `20${yy}-${mm}-${dd}`,
      vonMin: Number(h1) * 60 + Number(min1),
      bisMin: Number(h2) * 60 + Number(min2),
    });
  }

  // Wiederkehrend: "Jeden Montag, Dienstag und Donnerstag zwischen dem 03.08.26
  // und dem 12.08.26 von 07:00 bis 16:00 Uhr"
  const recRe =
    /Jeden\s+([A-Za-zÄÖÜäöü,\s und]+?)\s+zwischen\s+dem\s+(\d{2})\.(\d{2})\.(\d{2})\s+und\s+dem\s+(\d{2})\.(\d{2})\.(\d{2})\s+von\s+(\d{2}):(\d{2})\s+bis\s+(\d{2}):(\d{2})/g;
  while ((m = recRe.exec(text)) !== null) {
    const [, tageRaw, d1, m1, y1, d2, m2, y2, h1, mi1, h2, mi2] = m;
    const tage = [];
    for (const [name, idx] of Object.entries(WEEKDAYS)) {
      if (tageRaw.toLowerCase().includes(name)) tage.push(idx);
    }
    if (!tage.length) continue;
    windows.push({
      art: "wochentage",
      tage,
      abDatum: `20${y1}-${m1}-${d1}`,
      bisDatum: `20${y2}-${m2}-${d2}`,
      vonMin: Number(h1) * 60 + Number(mi1),
      bisMin: Number(h2) * 60 + Number(mi2),
    });
  }

  // Ausgenommene Tage: "Die Baustelle gilt nicht an folgenden Tagen: 07.08.26"
  const ausnahmen = [];
  const exIdx = lines.findIndex((l) => /gilt nicht an folgenden Tagen/i.test(l));
  if (exIdx >= 0) {
    for (const line of lines.slice(exIdx + 1)) {
      const e = line.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
      if (!e) break;
      ausnahmen.push(`20${e[3]}-${e[2]}-${e[1]}`);
    }
  }

  return { windows, ausnahmen };
}

async function fetchItemsForRef(ref, kind) {
  try {
    const data = await fetchJson(`${API_BASE}/${ref}/services/${kind}`);
    const key = kind === "roadworks" ? "roadworks" : "warning";
    return (data[key] || [])
      // Geplante, noch nicht begonnene Maßnahmen ausblenden – die API markiert sie
      // per `future`-Flag bzw. über einen künftigen Beginn im Beschreibungstext.
      .filter((item) => !item.future && parseIsInHorizon(item.description))
      .map((item) => {
        // Die API liefert die tatsächlich betroffene Teilstrecke als GeoJSON
        // LineString (item.geometry) – nur einen einzelnen "coordinate"-Punkt zu
        // nehmen würde bei langen Baustellentiteln (z.B. "A3 | Ort A - Ort B") viel
        // zu großzügig treffen. Fällt auf den Einzelpunkt zurück, falls keine
        // Geometrie vorhanden ist.
        const linePoints = Array.isArray(item.geometry?.coordinates)
          ? item.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
          : item.coordinate
          ? [{ lat: Number(item.coordinate.lat), lon: Number(item.coordinate.long) }]
          : [];

        return {
          id: `${ref}-${kind}-${item.identifier || item.title}`,
          ref,
          type: kind === "roadworks" ? "roadworks" : "warning",
          title: item.title || null,
          subtitle: item.subtitle || null,
          description: item.description || [],
          // Die API liefert isBlocked als String "true"/"false", nicht als Boolean.
          isBlocked: item.isBlocked === "true" || item.isBlocked === true,
          speedLimitKmh: parseSpeedLimitFromDescription(item.description),
          lengthKm: parseLengthKmFromDescription(item.description),
          ...parseTimeWindows(item.description),
          coordinate: item.coordinate
            ? { lat: Number(item.coordinate.lat), lon: Number(item.coordinate.long) }
            : null,
          linePoints,
        };
      });
  } catch (err) {
    console.error(`  Fehler bei ${ref}/${kind}: ${err.message}`);
    return [];
  }
}

// Kleinster Abstand zwischen der Baustellen-Linie (Folge von Punkten) und dem
// Routen-Abschnitt (start-end).
function lineToSegmentDistanceM(linePoints, start, end) {
  let best = Infinity;
  for (const p of linePoints) {
    const d = pointToSegmentDistanceM(p, start, end);
    if (d < best) best = d;
  }
  return best;
}

// Grobe Richtung einer Punktfolge als Vektor (Ende minus Anfang).
function directionVector(points) {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const latRef = toRad(a.lat);
  return {
    x: (toRad(b.lon) - toRad(a.lon)) * Math.cos(latRef),
    y: toRad(b.lat) - toRad(a.lat),
  };
}

// Zeigen Baustelle und Routen-Abschnitt in dieselbe Fahrtrichtung? Autobahnen haben
// getrennte Richtungsfahrbahnen, und die API liefert jede Baustelle separat je
// Richtung – ohne diesen Test würden Baustellen der Gegenfahrbahn mitgezählt, die
// die eigene Fahrzeit gar nicht beeinflussen.
function sameDirection(itemPoints, start, end) {
  const vItem = directionVector(itemPoints);
  const vSeg = directionVector([start, end]);
  if (!vItem || !vSeg) return true; // im Zweifel mitzählen
  const dot = vItem.x * vSeg.x + vItem.y * vSeg.y;
  const magItem = Math.hypot(vItem.x, vItem.y);
  const magSeg = Math.hypot(vSeg.x, vSeg.y);
  if (magItem === 0 || magSeg === 0) return true;
  // cos > 0 => spitzer Winkel => gleiche Richtung
  return dot / (magItem * magSeg) > 0;
}

function matchItemToRoutes(item, corridors) {
  if (!item.linePoints.length) return [];
  const affects = [];
  for (const corridor of corridors) {
    for (const route of corridor.routes) {
      route.segments.forEach((segment, index) => {
        if (segment.ref !== item.ref) return;
        const dist = lineToSegmentDistanceM(item.linePoints, segment.start, segment.end);
        if (dist > MATCH_DISTANCE_THRESHOLD_M) return;
        if (!sameDirection(item.linePoints, segment.start, segment.end)) return;
        affects.push({
          corridorId: corridor.id,
          routeId: route.id,
          segmentIndex: index,
          distanceMeters: Math.round(dist),
        });
      });
    }
  }
  return affects;
}

async function main() {
  let routesData;
  try {
    const raw = await readFile(new URL("../data/routes.json", import.meta.url), "utf-8");
    routesData = JSON.parse(raw);
  } catch {
    console.warn(
      "routes.json nicht gefunden – bitte zuerst fetch-route-speedlimits.mjs laufen lassen. " +
        "Schreibe leere roadworks.json."
    );
    routesData = { corridors: [] };
  }

  const refs = new Set();
  for (const corridor of routesData.corridors) {
    for (const route of corridor.routes) {
      for (const segment of route.segments || []) {
        if (segment.ref) refs.add(segment.ref);
      }
    }
  }

  const allItems = [];
  for (const ref of refs) {
    for (const kind of ["roadworks", "warning"]) {
      allItems.push(...(await fetchItemsForRef(ref, kind)));
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  const items = allItems
    .map((item) => ({ ...item, affects: matchItemToRoutes(item, routesData.corridors) }))
    .filter((item) => item.affects.length > 0)
    // linePoints war nur fürs Matching nötig, muss nicht mit ausgeliefert werden.
    .map(({ linePoints, ...rest }) => rest);

  const output = {
    updatedAt: new Date().toISOString(),
    items,
  };

  await writeFile(
    new URL("../data/roadworks.json", import.meta.url),
    JSON.stringify(output, null, 2) + "\n",
    "utf-8"
  );

  console.log(
    `roadworks.json geschrieben: ${items.length} relevante Meldungen (von ${allItems.length} geprüften) für ${refs.size} Autobahnen.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
