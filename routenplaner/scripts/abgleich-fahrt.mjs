// Hält eine aufgezeichnete Fahrt kilometerweise gegen das Modell: was wurde
// gefahren, was hätte der Planer für denselben Kilometer zur selben Uhrzeit
// gerechnet? Das ist das Werkzeug, mit dem die Koeffizienten geprüft werden.
//
//   node routenplaner/scripts/abgleich-fahrt.mjs fahrt.gpx [korridor] [--wunsch 150]
//        [--toleranz 0] [--stand fahrttag|aktuell|<commit>] [--csv datei]
//        [--lkw 15] [--dichte 4] [--spur3 0.1] [--anlage 0.2] [--spuren osm|bast]
//
// Ohne Korridor wird der genommen, auf dem die meisten Kilometer der Fahrt
// liegen. Verglichen wird nur, was auf einer hinterlegten Route liegt – der
// Rest (Stadt, andere Autobahnen) wird als "nicht zugeordnet" ausgewiesen.
//
// Zwei Dinge, die schon einmal ein falsches Ergebnis geliefert haben:
//
//  - Der Baustellenstand muss der des Fahrttags sein. Mit dem Stand von fünf
//    Tagen später sah eine Fahrt minutengenau getroffen aus, tatsächlich fehlten
//    acht Minuten. Deshalb holt das Skript roadworks.json aus der Git-Historie
//    (letzter Commit vor der Abfahrt) und dazu die routes.json desselben
//    Commits – die Meldungen sind über Segmentnummern zugeordnet und passen nur
//    zu ihrer eigenen Routendatei.
//  - Der Rechenkern kommt aus ../modell.js (dieselbe Datei wie in der
//    Fahrtauswertung im Browser). index.html und audit-route.mjs tragen ihn noch
//    als eigene Kopie – wer dort etwas ändert, muss modell.js nachziehen.
//
// Die Schalter --lkw, --dichte, --spur3 und --anlage überschreiben einzelne
// Koeffizienten, um Alternativen durchzurechnen, ohne den Code anzufassen.

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, "..", "..");

const args = process.argv.slice(2);
const SCHALTER = ["--wunsch", "--toleranz", "--stand", "--csv", "--lkw", "--dichte", "--spur3", "--anlage", "--spuren"];
const opt = {}, frei = [];
for (let i = 0; i < args.length; i++) {
  if (SCHALTER.includes(args[i])) opt[args[i].slice(2)] = args[++i];
  else frei.push(args[i]);
}
const [gpxPfad, korridorWunsch] = frei;
if (!gpxPfad) {
  console.error("Aufruf: node abgleich-fahrt.mjs <fahrt.gpx> [korridor] [--wunsch 150] [--stand fahrttag|aktuell|<commit>] [--csv datei]");
  process.exit(1);
}
const zahl = (k, d) => (opt[k] !== undefined ? Number(opt[k]) : d);
const WUNSCH = zahl("wunsch", 150);
const TOLERANZ = zahl("toleranz", 0);
const STAND = opt.stand || "fahrttag";
// Woher die Fahrstreifenzahl kommt: "osm" = je Kilometer aus dem Raster
// (speedgrid.json, Feld spuren), "bast" = von der nächsten Zählstelle.
const SPUREN_QUELLE = opt.spuren || "osm";

// --- Rechenkern: gemeinsam mit der Fahrtauswertung im Browser -----------------
// modell.js ist die eine Quelle für Verkehrsabzug, Wechselanzeige und
// Beschleunigen; hier kommen nur die Baustellen dazu.
const M = createRequire(import.meta.url)("../modell.js");
const KOEFF = {
  ...M.K,
  DICHTE: zahl("dichte", M.K.DICHTE),
  LKW: zahl("lkw", M.K.LKW),
  ENTLASTUNG_3: zahl("spur3", M.K.ENTLASTUNG_3),
  ANLAGE_ANTEIL: zahl("anlage", M.K.ANLAGE_ANTEIL),
};
const DICHTE_GEWICHT = KOEFF.DICHTE, LKW_GEWICHT = KOEFF.LKW, BLOCKIERT_FALLBACK = 60;
const { tagTyp, distKm } = M;


// --- Fahrt auswerten lassen --------------------------------------------------
// vergleich-fahrt.mjs trennt Fahrt von Halt und liefert je Kilometer Autobahn,
// Limit, gefahrenes Tempo, Uhrzeit und Ort. Darauf setzt der Abgleich auf.
const tmp = await mkdtemp(join(tmpdir(), "abgleich-"));
let fahrt, abfahrt;
try {
  const csvTmp = join(tmp, "fahrt.csv");
  const ausgabe = execFileSync("node", [join(HIER, "vergleich-fahrt.mjs"), gpxPfad, "--csv", csvTmp], { encoding: "utf8" });
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{2}):(\d{2}):\d{2} bis/.exec(ausgabe);
  if (!m) throw new Error("Abfahrtszeit nicht in der Ausgabe von vergleich-fahrt.mjs gefunden");
  abfahrt = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  fahrt = (await readFile(csvTmp, "utf8")).trim().split("\n").slice(1).map((l) => {
    const [km, ab, limit, anzeige, v, , uhr, lat, lon] = l.split(";");
    return { km: +km, ab, limit, anzeige, v: +v, uhr, lat: +lat, lon: +lon };
  });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
// Aus "HH:MM" wieder einen Zeitpunkt machen; nach Mitternacht einen Tag weiter.
{
  let tag = new Date(abfahrt.getFullYear(), abfahrt.getMonth(), abfahrt.getDate()), vorMin = -1;
  for (const r of fahrt) {
    const [h, mi] = r.uhr.split(":").map(Number);
    if (h * 60 + mi < vorMin - 720) tag = new Date(tag.getTime() + 86400_000);
    vorMin = h * 60 + mi;
    r.zeit = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), h, mi);
  }
}

// --- Daten laden: Routen und Baustellen vom Fahrttag -------------------------
const ladeDatei = async (name) => JSON.parse(await readFile(join(HIER, "..", "data", name), "utf8"));
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
let routes, roadworks, standText;
if (STAND === "aktuell") {
  routes = await ladeDatei("routes.json");
  roadworks = await ladeDatei("roadworks.json");
  standText = "aktuelle Dateien (nicht der Fahrttag!)";
} else {
  try {
    const commit = STAND === "fahrttag"
      ? git("log", "-1", `--before=${abfahrt.toISOString()}`, "--format=%H", "--", "routenplaner/data/roadworks.json").trim()
      : git("rev-parse", STAND).trim();
    if (!commit) throw new Error("kein Commit vor der Abfahrt");
    routes = JSON.parse(git("show", `${commit}:routenplaner/data/routes.json`));
    roadworks = JSON.parse(git("show", `${commit}:routenplaner/data/roadworks.json`));
    standText = `Commit ${commit.slice(0, 7)} vom ${git("log", "-1", "--format=%cd", "--date=format:%d.%m.%Y %H:%M", commit).trim()}`;
  } catch (err) {
    console.error(`Baustellenstand des Fahrttags nicht verfügbar (${err.message.split("\n")[0]}) – rechne mit den aktuellen Dateien.`);
    routes = await ladeDatei("routes.json");
    roadworks = await ladeDatei("roadworks.json");
    standText = "aktuelle Dateien (Fahrttag nicht verfügbar)";
  }
}
const traffic = await ladeDatei("traffic.json");
// Fahrstreifen je Kilometer – immer der aktuelle Stand, Spuren ändern sich kaum.
const speedgrid = await ladeDatei("speedgrid.json");
const spurenAn = M.spurIndex(speedgrid);
const spurenOsm = (seg) => spurenAn(seg.ref, (seg.start.lat + seg.end.lat) / 2, (seg.start.lon + seg.end.lon) / 2);
const verkehrAn = M.verkehrsIndex(traffic.stationen);
const praktisch = (wunsch, t, d) => M.praktisch(wunsch, t, d, KOEFF);
function grenze(seg, tol) {
  if (seg.maxspeedTag === "none") return null;
  if (typeof seg.maxspeedTag === "number") return seg.maxspeedTag + tol;
  if (seg.ref) return seg.fallbackSpeedKmh + tol;
  return seg.fallbackSpeedKmh;
}
const datumKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fensterGilt = (w, min) => w.bisMin <= w.vonMin ? (min >= w.vonMin || min < w.bisMin) : (min >= w.vonMin && min < w.bisMin);
function aktivUm(item, d) {
  const key = datumKey(d);
  if ((item.ausnahmen || []).includes(key)) return false;
  const w = item.windows || [];
  if (!w.length) return true;
  const min = d.getHours() * 60 + d.getMinutes(), tag = d.getDay();
  return w.some((x) => x.art === "datum" ? (x.datum === key && fensterGilt(x, min))
    : x.art === "wochentage" ? (x.tage.includes(tag) && key >= x.abDatum && key <= x.bisDatum && fensterGilt(x, min)) : false);
}
const wirkt = (i) => Boolean(i.speedLimitKmh) || i.isBlocked;
function abdeckung(item, routeId) {
  if (!item.lengthKm) return 1;
  const n = item.affects.filter((a) => a.routeId === routeId).length;
  return n ? Math.min(1, item.lengthKm / n) : 1;
}

// --- Fahrtkilometer den Routensegmenten zuordnen -----------------------------
// Je Korridor ein Suchraster über die Segmentanfänge. Die Gegenfahrbahn liegt
// nur 30 m daneben und hätte dieselben Koordinaten – deshalb entscheidet der
// Korridor über die Richtung, und es zählt nur ein Segment derselben Autobahn.
function raster(korridor) {
  const g = new Map();
  for (const r of korridor.routes) (r.segments || []).forEach((seg, i) => {
    if (!seg.ref) return;
    const k = `${Math.round(seg.start.lat * 50)}|${Math.round(seg.start.lon * 50)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push({ routeId: r.id, i, seg });
  });
  return (lat, lon, ab) => {
    let b = null, bd = Infinity;
    const gi = Math.round(lat * 50), gj = Math.round(lon * 50);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++)
      for (const s of g.get(`${gi + di}|${gj + dj}`) || []) {
        if (s.seg.ref !== ab) continue;
        const d = distKm(lat, lon, s.seg.start.lat, s.seg.start.lon);
        if (d < bd) { bd = d; b = s; }
      }
    return bd <= 0.8 ? b : null;
  };
}
// Kilometer im Stand oder Schritttempo sind Halt oder Stau am Rastplatz, keine
// Fahrt, an der sich das Modell messen ließe.
const fahrbar = fahrt.filter((r) => r.ab && r.v >= 25);

let korridor = null, suche = null;
if (korridorWunsch) {
  korridor = routes.corridors.find((c) => c.id === korridorWunsch);
  if (!korridor) { console.error("Korridor unbekannt:", routes.corridors.map((c) => c.id).join(", ")); process.exit(1); }
  suche = raster(korridor);
} else {
  // Mehrere Korridore können dieselben Autobahnen teilen (München → Köln und
  // München → Norddeich laufen bis Würzburg gleich). Unter denen, die fast
  // gleich viele Kilometer abdecken, gewinnt der, dessen Ziel dem Ende der
  // Fahrt am nächsten liegt.
  const ende = fahrt[fahrt.length - 1];
  const kandidaten = [];
  for (const c of routes.corridors) {
    const s = raster(c);
    // Richtung prüfen: auf dem richtigen Korridor steigen die Segmentnummern
    // entlang der Fahrt, auf dem der Gegenrichtung fallen sie.
    let n = 0, vor = null, steigt = 0, faellt = 0;
    for (const r of fahrbar) {
      const m = s(r.lat, r.lon, r.ab);
      if (!m) continue;
      n++;
      if (vor && vor.routeId === m.routeId) { if (m.i > vor.i) steigt++; else if (m.i < vor.i) faellt++; }
      vor = m;
    }
    const ziel = c.routes.find((r) => r.segments?.length)?.segments.at(-1).end;
    if (steigt > faellt && ziel) kandidaten.push({ c, s, n, fern: distKm(ende.lat, ende.lon, ziel.lat, ziel.lon) });
  }
  const meiste = Math.max(0, ...kandidaten.map((k) => k.n));
  const wahl = kandidaten.filter((k) => k.n >= 0.9 * meiste).sort((a, b) => a.fern - b.fern)[0];
  if (wahl) { korridor = wahl.c; suche = wahl.s; }
  if (!korridor) { console.error("Die Fahrt liegt auf keiner hinterlegten Route."); process.exit(1); }
}

// --- Kilometer für Kilometer rechnen -----------------------------------------
const zeilen = [];
let vorTempo = null, vorKm = -9;
for (const r of fahrbar) {
  const m = suche(r.lat, r.lon, r.ab);
  if (!m) { vorTempo = null; continue; }
  const seg = m.seg;
  const basis0 = grenze(seg, TOLERANZ);
  let basis = basis0 === null ? WUNSCH : Math.min(WUNSCH, basis0);
  const anlage = basis0 === null && Boolean(seg.variable);
  if (anlage) basis = Math.min(basis, M.anlageGrenze(WUNSCH, KOEFF));
  let tr = verkehrAn(seg.ref, seg.start.lat, seg.start.lon, tagTyp(r.zeit));
  const osm = SPUREN_QUELLE === "osm" ? spurenOsm(seg) : null;
  if (tr && osm !== null) tr = { ...tr, spuren: osm };
  const nachVerkehr = Math.min(basis, praktisch(WUNSCH, tr, r.zeit));
  const treffer = roadworks.items.filter((it) =>
    it.affects.some((a) => a.corridorId === korridor.id && a.routeId === m.routeId && a.segmentIndex === m.i)
    && aktivUm(it, r.zeit) && wirkt(it));
  let std, tempo = nachVerkehr, weiterAus = nachVerkehr, bwLimit = null;
  if (treffer.length) {
    bwLimit = Math.min(...treffer.map((x) => x.speedLimitKmh ? x.speedLimitKmh + TOLERANZ : BLOCKIERT_FALLBACK));
    const bwTempo = Math.min(nachVerkehr, bwLimit);
    const anteil = Math.max(...treffer.map((x) => abdeckung(x, m.routeId)));
    std = anteil / bwTempo + (1 - anteil) / nachVerkehr;   // je Kilometer
    tempo = 1 / std;
    weiterAus = bwTempo;
  } else {
    std = 1 / nachVerkehr;
  }
  // Beschleunigen nur über lückenlos aufeinanderfolgende Kilometer.
  const zuschlag = vorTempo && r.km - vorKm === 1 ? M.beschlZuschlagStd(vorTempo, tempo, KOEFF) : 0;
  vorTempo = weiterAus; vorKm = r.km;
  zeilen.push({
    ...r, modell: tempo, modellStd: std + zuschlag, realStd: 1 / r.v, bwLimit,
    spuren: tr ? Math.round(tr.spuren) : 0,
    klasse: bwLimit ? "Baustelle (laut Modell)" : basis0 === null ? (anlage ? "unbegrenzt unter Anzeige" : "unbegrenzt") : "Limit",
  });
}

// --- Ausgabe -----------------------------------------------------------------
const fmt = (h) => `${Math.floor(Math.round(h * 60) / 60)}h${String(Math.round(h * 60) % 60).padStart(2, "0")}`;
function zeile(name, a) {
  if (!a.length) return;
  const real = a.reduce((s, x) => s + x.realStd, 0), mod = a.reduce((s, x) => s + x.modellStd, 0);
  const d = (mod - real) * 60;
  console.log(`  ${name.padEnd(28)} ${String(a.length).padStart(4)} km   real ${fmt(real)} Ø ${(a.length / real).toFixed(0).padStart(3)}   Modell ${fmt(mod)} Ø ${(a.length / mod).toFixed(0).padStart(3)}   ${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} min`);
}
const gruppen = (schluessel) => {
  const g = new Map();
  for (const z of zeilen) { const k = schluessel(z); if (!g.has(k)) g.set(k, []); g.get(k).push(z); }
  return g;
};

console.log(`${korridor.name}   ${abfahrt.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`);
console.log(`Wunsch ${WUNSCH} km/h, Toleranz +${TOLERANZ}, LKW-Gewicht ${LKW_GEWICHT}, Dichte ${DICHTE_GEWICHT}, Fahrstreifen aus ${SPUREN_QUELLE === "osm" ? "OSM" : "BASt"}`);
console.log(`Routen und Baustellen: ${standText}`);
console.log(`Zugeordnet: ${zeilen.length} von ${fahrt.length} km der Fahrt (Rest: Stadt, Halt oder keine hinterlegte Route)`);
console.log("\nAbweichung: + heißt Modell zu langsam, − zu schnell\n");
zeile("GESAMT", zeilen);
console.log("\nNach Streckenart");
for (const [k, a] of gruppen((z) => z.klasse)) zeile(k, a);
console.log(`\nUnbegrenzt ohne Anzeige, nach Autobahn und Fahrstreifen (${SPUREN_QUELLE === "osm" ? "OSM je Kilometer" : "BASt-Zählstelle"})`);
for (const [k, a] of gruppen((z) => z.klasse === "unbegrenzt" ? `${z.ab}, ${z.spuren || "?"} Spuren` : null)) if (k) zeile(k, a);
console.log("\nNach Stunde");
for (const [k, a] of gruppen((z) => `${z.uhr.slice(0, 2)} Uhr`)) zeile(k, a);

if (opt.csv) {
  const kopf = "km;autobahn;klasse;spuren;baustelle_limit;gefahren_kmh;modell_kmh;uhrzeit;lat;lon";
  const text = [kopf, ...zeilen.map((z) => [z.km, z.ab, z.klasse, z.spuren, z.bwLimit ?? "", z.v, Math.round(z.modell), z.uhr, z.lat, z.lon].join(";"))].join("\n") + "\n";
  await writeFile(opt.csv, text, "utf8");
  console.log(`\nCSV geschrieben: ${opt.csv} (${zeilen.length} Kilometer)`);
}
