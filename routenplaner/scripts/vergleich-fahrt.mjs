// Vergleicht eine tatsächlich gefahrene Strecke mit der Modellrechnung.
//
// Eingabe ist eine GPX-Datei, wie sie jede Aufzeichnungs-App exportiert – nötig
// sind nur Trackpunkte mit Zeitstempel (<trkpt lat lon><time>). Daraus wird das
// real gefahrene Tempo je Kilometer bestimmt und dem gegenübergestellt, was das
// Modell für denselben Streckenkilometer angenommen hat.
//
// Aufruf:
//   node routenplaner/scripts/vergleich-fahrt.mjs fahrt.gpx [--csv ausgabe.csv]
//
// Die passende hinterlegte Route wird automatisch gesucht (größte Überdeckung).

import { readFile, writeFile } from "node:fs/promises";

const [, , gpxPfad, ...rest] = process.argv;
if (!gpxPfad) {
  console.error("Aufruf: node vergleich-fahrt.mjs <datei.gpx> [--csv ausgabe.csv]");
  process.exit(1);
}
const csvIdx = rest.indexOf("--csv");
const CSV = csvIdx >= 0 ? rest[csvIdx + 1] : null;

const rad = (d) => (d * Math.PI) / 180;

// Abstand Punkt -> Streckenabschnitt (nicht zu dessen Startpunkt!). Zum Startpunkt
// zu messen verschiebt jeden Messwert um einen halben Kilometer: ein Punkt in der
// Segmentmitte ist von beiden Enden gleich weit entfernt und landet zur Hälfte im
// Nachbarkilometer. Bei wechselnden Limits ergibt das systematisch zu hohe Werte.
function abstandZuAbschnitt(p, a, b) {
  const R = 6371000;
  const latRef = rad(a.lat);
  const x = (lon) => rad(lon) * Math.cos(latRef) * R;
  const y = (lat) => rad(lat) * R;
  const px = x(p.lon), py = y(p.lat);
  const ax = x(a.lon), ay = y(a.lat);
  const bx = x(b.lon), by = y(b.lat);
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

// --- GPX einlesen ------------------------------------------------------------
// Bewusst ohne XML-Bibliothek: GPX-Trackpunkte haben eine feste, simple Form.
function parseGpx(xml) {
  const punkte = [];
  const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const zeit = /<time>([^<]+)<\/time>/.exec(m[3]);
    if (!zeit) continue;
    const t = new Date(zeit[1]);
    if (Number.isNaN(t.getTime())) continue;
    punkte.push({ lat: +m[1], lon: +m[2], t });
  }
  // Auch <trkpt .../> ohne Kindelemente kommt vor – die haben aber keine Zeit
  // und sind für uns nutzlos.
  return punkte.sort((a, b) => a.t - b.t);
}

const xml = await readFile(gpxPfad, "utf8");
const punkte = parseGpx(xml);
if (punkte.length < 10) {
  console.error(`Zu wenige Trackpunkte mit Zeitstempel gefunden (${punkte.length}).`);
  process.exit(1);
}

const dauerH = (punkte[punkte.length - 1].t - punkte[0].t) / 3600000;
let gesamtM = 0;
for (let i = 1; i < punkte.length; i++) gesamtM += distM(punkte[i - 1], punkte[i]);

console.log(`Aufzeichnung: ${punkte.length} Punkte, ${(gesamtM / 1000).toFixed(1)} km, ` +
  `${Math.floor(dauerH)}h${String(Math.round((dauerH % 1) * 60)).padStart(2, "0")} ` +
  `(Ø ${(gesamtM / 1000 / dauerH).toFixed(0)} km/h)`);
console.log(`Start ${punkte[0].t.toLocaleString("de-DE")}\n`);

// --- passende hinterlegte Route suchen --------------------------------------
const routes = JSON.parse(await readFile(new URL("../data/routes.json", import.meta.url), "utf8"));
function ueberdeckung(segmente) {
  const zellen = new Set(segmente.map(s => `${Math.round(s.start.lat * 50)}|${Math.round(s.start.lon * 50)}`));
  let treffer = 0;
  for (const pkt of punkte) if (zellen.has(`${Math.round(pkt.lat * 50)}|${Math.round(pkt.lon * 50)}`)) treffer++;
  return treffer / punkte.length;
}
let beste = null, besteQuote = 0;
for (const k of routes.corridors) for (const r of k.routes) {
  if (!r.segments?.length) continue;
  const q = ueberdeckung(r.segments);
  if (q > besteQuote) { besteQuote = q; beste = { k, r }; }
}
if (!beste || besteQuote < 0.4) {
  console.error(`Keine hinterlegte Route passt (beste Überdeckung ${(besteQuote * 100).toFixed(0)} %).`);
  console.error("Für den Vergleich muss die Fahrt einer der hinterlegten Strecken entsprechen.");
  process.exit(1);
}
console.log(`Passende Route: ${beste.k.name} – ${beste.r.label}  (${(besteQuote * 100).toFixed(0)} % Überdeckung)\n`);

// --- GPS-Punkte auf die Route projizieren ------------------------------------
// Jeder Punkt bekommt den Streckenkilometer, auf dem er liegt. Nur so lässt sich
// "gefahrenes Tempo an Streckenkilometer X" bilden. Eine Zuordnung über den
// gefahrenen Kilometerzähler driftet, weil aufgezeichnete und modellierte Länge
// nie exakt gleich sind. Die Suche läuft monoton vorwärts in einem Fenster, damit
// sie an Kreuzen und Stadtschleifen nicht auf einen anderen Streckenteil springt.
const segs = beste.r.segments;
const zeitProKm = new Array(segs.length).fill(0);   // Sekunden je Streckenkilometer
const wegProKm  = new Array(segs.length).fill(0);   // Meter je Streckenkilometer
let zeiger = 0;
let letzterIdx = null;
for (let i = 1; i < punkte.length; i++) {
  const a = punkte[i - 1], b = punkte[i];
  const dS = (b.t - a.t) / 1000;
  const dM = distM(a, b);
  if (dS <= 0 || dS > 600) continue;               // Lücken in der Aufzeichnung überspringen

  let idx = null, bd = Infinity;
  for (let j = zeiger; j < Math.min(segs.length, zeiger + 40); j++) {
    const d = abstandZuAbschnitt(b, segs[j].start, segs[j].end);
    if (d < bd) { bd = d; idx = j; }
  }
  if (idx === null || bd > 3000) continue;         // abseits der Route
  zeiger = Math.max(zeiger, idx - 2);
  zeitProKm[idx] += dS;
  wegProKm[idx] += dM;
  letzterIdx = idx;
}

// --- Gegenüberstellung -------------------------------------------------------
const zeilen = ["streckenkm;autobahn;osm_limit;modell_kmh;gefahren_kmh;differenz"];
console.log("   km   Autobahn  OSM-Limit    Modell   gefahren   Differenz");
const auffaellig = [];
const zeigen = [];
segs.forEach((seg, i) => {
  if (wegProKm[i] < 300 || zeitProKm[i] <= 0) return;      // kein belastbarer Messwert
  const ist = (wegProKm[i] / 1000) / (zeitProKm[i] / 3600);
  const limit = seg.maxspeedTag === "none" ? "unbegrenzt" : (seg.maxspeedTag ?? `~${seg.fallbackSpeedKmh}`);
  // Verglichen wird gegen die reine Limitseite: zeigt, ob die Limits stimmen.
  const modell = seg.maxspeedTag === "none" ? null
    : (typeof seg.maxspeedTag === "number" ? seg.maxspeedTag : seg.fallbackSpeedKmh);
  const diff = modell ? ist - modell : null;
  zeilen.push([i + 1, seg.ref || "Ort", limit, modell ?? "", ist.toFixed(0), diff?.toFixed(0) ?? ""].join(";"));
  zeigen.push({ km: i + 1, ref: seg.ref, limit, modell, ist, diff });
  if (modell && diff > 25) auffaellig.push({ km: i + 1, ref: seg.ref, limit, modell, ist, diff });
});
for (const z of zeigen.filter((_, i) => i % 25 === 0)) {
  console.log(`  ${String(z.km).padStart(4)}   ${(z.ref || "Ort").padEnd(8)} ${String(z.limit).padEnd(12)} ` +
    `${(z.modell ? String(z.modell) : "frei").padStart(6)}   ${z.ist.toFixed(0).padStart(6)}   ` +
    `${z.modell ? (z.diff >= 0 ? "+" : "") + z.diff.toFixed(0) : ""}`);
}
console.log(`\nAusgewertete Streckenkilometer: ${zeigen.length} von ${segs.length}`);
const frei = zeigen.filter(z => !z.modell);
if (frei.length) {
  const schnitt = frei.reduce((a, z) => a + z.ist, 0) / frei.length;
  console.log(`Auf unbegrenzten Abschnitten tatsächlich gefahren: Ø ${schnitt.toFixed(0)} km/h ` +
    `(Median ${frei.map(z => z.ist).sort((a, b) => a - b)[Math.floor(frei.length / 2)].toFixed(0)})`);
  console.log(`  -> dieser Wert gehört als "Wunschtempo" in den Planer.`);
}
const begrenzt = zeigen.filter(z => z.modell && z.ref);
if (begrenzt.length) {
  const ueber = begrenzt.reduce((a, z) => a + z.diff, 0) / begrenzt.length;
  console.log(`Auf begrenzten Autobahnabschnitten im Mittel ${ueber >= 0 ? "+" : ""}${ueber.toFixed(0)} km/h gegenüber dem Limit`);
  console.log(`  -> dieser Wert gehört als "Tempo über Limits" in den Planer.`);
}
if (auffaellig.length) {
  console.log(`\nDeutlich über dem Limit (>25 km/h): ${auffaellig.length} Kilometer`);
  for (const a of auffaellig.slice(0, 8))
    console.log(`  km ${String(a.km).padStart(4)}  ${a.ref}  Limit ${a.limit}, gefahren ${a.ist.toFixed(0)}`);
}

if (CSV) { await writeFile(CSV, zeilen.join("\n") + "\n", "utf8"); console.log(`\nCSV geschrieben: ${CSV} (${zeilen.length - 1} Kilometer)`); }
