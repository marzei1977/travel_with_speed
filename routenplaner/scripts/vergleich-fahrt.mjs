// Wertet eine aufgezeichnete Fahrt aus und vergleicht sie mit den hinterlegten
// Tempolimits.
//
// Eingabe ist eine GPX-Datei, wie sie jede Aufzeichnungs-App exportiert (getestet
// mit Open GPX Tracker für iOS). Nötig sind nur Trackpunkte mit Zeitstempel.
//
//   node routenplaner/scripts/vergleich-fahrt.mjs fahrt.gpx [--csv datei] [--html datei]
//
// Die Auswertung braucht keine hinterlegte Route: die Autobahn und ihr Limit
// werden für jeden Kilometer aus dem bundesweiten Raster bestimmt. Damit
// funktioniert sie für jede Fahrt in Deutschland.
//
// Am Ende stehen die beiden Zahlen, die in den Planer gehören: das tatsächlich
// gehaltene Tempo auf unbegrenzten Abschnitten und der mittlere Abstand zum
// ausgeschilderten Limit.

import { readFile, writeFile } from "node:fs/promises";

const [, , gpxPfad, ...rest] = process.argv;
if (!gpxPfad) {
  console.error("Aufruf: node vergleich-fahrt.mjs <datei.gpx> [--csv datei] [--html datei]");
  process.exit(1);
}
const argOf = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : null; };
const CSV = argOf("--csv");
const HTML = argOf("--html");

// Trennt Fahrblöcke: längere Unterbrechung heißt Pause, nicht Fahrt.
const PAUSE_S = 180;
// Einzelne Punkte mit unmöglichem Tempo sind GPS-Rauschen. Sie werden entfernt,
// nicht als Blockgrenze behandelt: ein einziger Ausreißer würde sonst eine
// zusammenhängende Fahrt zerteilen und die Hälfte der Strecke verwerfen.
const MAX_KMH = 260;

const rad = (d) => (d * Math.PI) / 180;
function distM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
const fmtH = (h) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

// --- GPX einlesen ------------------------------------------------------------
const xml = await readFile(gpxPfad, "utf8");
const alle = [];
{
  const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = /<time>([^<]+)<\/time>/.exec(m[3]);
    if (!t) continue;
    const d = new Date(t[1]);
    if (!Number.isNaN(d.getTime())) alle.push({ lat: +m[1], lon: +m[2], t: d });
  }
}
alle.sort((a, b) => a.t - b.t);
if (alle.length < 20) { console.error(`Zu wenige Trackpunkte (${alle.length}).`); process.exit(1); }

// Ausreißer entfernen: Punkte, die vom Vorgänger aus nur mit unmöglichem Tempo
// erreichbar wären. Geprüft wird gegen den letzten behaltenen Punkt, damit ein
// einzelner Fehlpunkt nicht die ganze folgende Kette verwirft.
const bereinigt = [alle[0]];
let ausreisser = 0;
for (let i = 1; i < alle.length; i++) {
  const vor = bereinigt[bereinigt.length - 1];
  const dS = (alle[i].t - vor.t) / 1000;
  if (dS <= 0) continue;
  if (dS <= PAUSE_S && (distM(vor, alle[i]) / dS) * 3.6 > MAX_KMH) { ausreisser++; continue; }
  bereinigt.push(alle[i]);
}

// --- Fahrt aus der Aufzeichnung herauslösen ----------------------------------
// Aufzeichnungen enthalten regelmäßig Vor- und Nachlauf: die App lief schon vor
// der Abfahrt oder wurde am Ziel nicht gestoppt. Statt Zeilen von Hand zu löschen
// wird an Pausen getrennt und der längste zusammenhängende Fahrblock genommen.
const bloecke = [];
{
  let von = 0, km = 0;
  for (let i = 1; i < bereinigt.length; i++) {
    const dS = (bereinigt[i].t - bereinigt[i - 1].t) / 1000;
    if (dS > PAUSE_S) {
      bloecke.push({ von, bis: i - 1, km });
      von = i; km = 0;
    } else km += distM(bereinigt[i - 1], bereinigt[i]) / 1000;
  }
  bloecke.push({ von, bis: bereinigt.length - 1, km });
}
bloecke.sort((a, b) => b.km - a.km);
const haupt = bloecke[0];
const punkte = bereinigt.slice(haupt.von, haupt.bis + 1);
const verworfen = alle.length - punkte.length;

const dauerH = (punkte[punkte.length - 1].t - punkte[0].t) / 3600000;
let gesamtM = 0;
for (let i = 1; i < punkte.length; i++) gesamtM += distM(punkte[i - 1], punkte[i]);

console.log(`Aufzeichnung: ${alle.length} Punkte über ${((alle[alle.length-1].t - alle[0].t) / 3600000).toFixed(1)} h`);
console.log(`Ausgewertete Fahrt: ${punkte.length} Punkte, ${(gesamtM / 1000).toFixed(1)} km, ${fmtH(dauerH)}, Ø ${(gesamtM / 1000 / dauerH).toFixed(0)} km/h`);
console.log(`  ${punkte[0].t.toLocaleString("de-DE")} bis ${punkte[punkte.length - 1].t.toLocaleString("de-DE")}`);
if (verworfen) console.log(`  ${verworfen} Punkte verworfen: Pausen vor/nach der Fahrt${ausreisser ? `, davon ${ausreisser} GPS-Ausreißer` : ""}`);

// --- Tempolimit-Raster -------------------------------------------------------
const grid = JSON.parse(await readFile(new URL("../data/speedgrid.json", import.meta.url), "utf8"));
// Zellen nach Ort indizieren, damit zu einem Punkt die Autobahn gefunden wird.
const zellen = new Map();
for (const [ref, flat] of Object.entries(grid.refs)) {
  let la = 0, lo = 0;
  for (let i = 0; i < flat.length; i += 3) {
    la += flat[i]; lo += flat[i + 1];
    const key = `${la}|${lo}`;
    if (!zellen.has(key)) zellen.set(key, []);
    zellen.get(key).push({ ref, ms: flat[i + 2], lat: la / grid.grid, lon: lo / grid.grid });
  }
}
function limitAn(lat, lon) {
  const la = Math.round(lat * grid.grid), lo = Math.round(lon * grid.grid);
  let best = null, bd = Infinity;
  for (let d1 = -1; d1 <= 1; d1++) for (let d2 = -1; d2 <= 1; d2++) {
    for (const z of zellen.get(`${la + d1}|${lo + d2}`) || []) {
      const d = distM({ lat, lon }, z);
      if (d < bd) { bd = d; best = z; }
    }
  }
  return best && bd < 600 ? { ref: best.ref, ms: best.ms, abstand: bd } : null;
}

// --- Kilometerweise auswerten ------------------------------------------------
const kmZeilen = [];
{
  let km = 0, restM = 0, restS = 0, mitte = null;
  for (let i = 1; i < punkte.length; i++) {
    let dM = distM(punkte[i - 1], punkte[i]);
    let dS = (punkte[i].t - punkte[i - 1].t) / 1000;
    if (dS <= 0) continue;
    while (restM + dM >= 1000) {
      const anteil = (1000 - restM) / dM;
      restS += dS * anteil;
      const treffer = limitAn(punkte[i].lat, punkte[i].lon);
      kmZeilen.push({
        km: ++km, kmh: 3600 / restS,
        ref: treffer?.ref ?? null,
        ms: treffer ? treffer.ms : null,
        lat: punkte[i].lat, lon: punkte[i].lon, t: punkte[i].t,
      });
      dM -= 1000 - restM; dS -= dS * anteil;
      restM = 0; restS = 0;
    }
    restM += dM; restS += dS;
  }
}

const aufAutobahn = kmZeilen.filter((z) => z.ref);
const frei = aufAutobahn.filter((z) => z.ms === 0);
const begrenzt = aufAutobahn.filter((z) => z.ms > 0);

console.log(`\nDavon auf erfasster Autobahn: ${aufAutobahn.length} km (${((aufAutobahn.length / kmZeilen.length) * 100).toFixed(0)} %)`);
if (aufAutobahn.length < kmZeilen.length)
  console.log(`  ${kmZeilen.length - aufAutobahn.length} km ohne Zuordnung – Ausland, Bundesstraße oder Stadt`);

console.log("\n   km   Autobahn  Limit        gefahren   Abstand");
for (const z of kmZeilen.filter((_, i) => i % Math.max(1, Math.ceil(kmZeilen.length / 30)) === 0)) {
  const lim = !z.ref ? "–" : z.ms === 0 ? "unbegrenzt" : String(z.ms);
  const diff = z.ref && z.ms > 0 ? (z.kmh - z.ms >= 0 ? "+" : "") + (z.kmh - z.ms).toFixed(0) : "";
  console.log(`  ${String(z.km).padStart(4)}   ${(z.ref || "–").padEnd(8)} ${lim.padEnd(12)} ${z.kmh.toFixed(0).padStart(6)}   ${diff}`);
}

console.log("\n── Auswertung ──");
if (frei.length) {
  const s = frei.map((z) => z.kmh).sort((a, b) => a - b);
  const schnitt = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(`Unbegrenzte Abschnitte: ${frei.length} km, Ø ${schnitt.toFixed(0)} km/h, Median ${s[Math.floor(s.length / 2)].toFixed(0)}, oberes Viertel ab ${s[Math.floor(s.length * 0.75)].toFixed(0)}`);
  console.log(`  -> "Wunschtempo" im Planer: ${Math.round(schnitt / 5) * 5} km/h`);
} else console.log("Keine unbegrenzten Abschnitte in dieser Fahrt.");
if (begrenzt.length) {
  const d = begrenzt.map((z) => z.kmh - z.ms).sort((a, b) => a - b);
  const schnitt = d.reduce((a, b) => a + b, 0) / d.length;
  console.log(`Begrenzte Abschnitte: ${begrenzt.length} km, im Mittel ${schnitt >= 0 ? "+" : ""}${schnitt.toFixed(0)} km/h zum Limit, Median ${d[Math.floor(d.length / 2)] >= 0 ? "+" : ""}${d[Math.floor(d.length / 2)].toFixed(0)}`);
  console.log(`  -> "Tempo über Limits" im Planer: ${Math.max(0, Math.round(schnitt / 5) * 5)} km/h`);
} else console.log("Keine begrenzten Autobahnabschnitte in dieser Fahrt.");

// --- Dateien -----------------------------------------------------------------
if (CSV) {
  const zeilen = ["km;autobahn;limit;gefahren_kmh;abstand_zum_limit;uhrzeit;lat;lon"];
  for (const z of kmZeilen)
    zeilen.push([z.km, z.ref ?? "", z.ref ? (z.ms === 0 ? "frei" : z.ms) : "", z.kmh.toFixed(0),
      z.ref && z.ms > 0 ? (z.kmh - z.ms).toFixed(0) : "", z.t.toISOString().slice(11, 16),
      z.lat.toFixed(5), z.lon.toFixed(5)].join(";"));
  await writeFile(CSV, zeilen.join("\n") + "\n", "utf8");
  console.log(`\nCSV geschrieben: ${CSV} (${kmZeilen.length} Kilometer)`);
}
if (HTML) {
  const farbe = (v) => v >= 170 ? "#1d8a3f" : v >= 140 ? "#4a9c2d" : v >= 115 ? "#b8860b" : v >= 80 ? "#c2410c" : "#a01b1b";
  await writeFile(HTML, `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Gefahrene Strecke</title><style>
 body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:2rem;background:#f5f5f7;color:#1d1d1f}
 h1{font-size:1.6rem;letter-spacing:-.02em;margin:0 0 .3rem}.meta{color:#86868b;margin:0 0 2rem}
 table{border-collapse:collapse;width:100%;max-width:760px;background:#fff;border-radius:10px;overflow:hidden;
   box-shadow:0 1px 3px rgba(0,0,0,.08);font-variant-numeric:tabular-nums}
 th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#86868b;text-align:left;padding:.6rem .7rem;border-bottom:1px solid #e5e5e7}
 td{padding:.35rem .7rem;border-bottom:1px solid #f0f0f2}.n{text-align:right}.t{color:#86868b}.hl{font-weight:650}
 tr:hover td{background:#f5f8ff}
 @media(prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}table{background:#1c1c1e}th{border-color:#2c2c2e}td{border-color:#242426}tr:hover td{background:#26262a}}
</style></head><body><h1>Gefahrene Strecke</h1>
<p class="meta">${(gesamtM/1000).toFixed(1)} km · ${fmtH(dauerH)} · Ø ${(gesamtM/1000/dauerH).toFixed(0)} km/h ·
${punkte[0].t.toLocaleString("de-DE")}<br>Limit aus dem bundesweiten OSM-Raster; leer heißt Ausland, Bundesstraße oder Stadt.</p>
<table><thead><tr><th>km</th><th>Autobahn</th><th>Limit</th><th>gefahren</th><th>Abstand</th><th>Uhrzeit</th></tr></thead><tbody>
${kmZeilen.map((z) => `<tr><td class="n">${z.km}</td><td>${z.ref ?? '<span class="t">–</span>'}</td>
<td>${!z.ref ? "" : z.ms === 0 ? "unbegrenzt" : z.ms}</td>
<td class="n hl" style="color:${farbe(z.kmh)}">${z.kmh.toFixed(0)}</td>
<td class="n">${z.ref && z.ms > 0 ? (z.kmh - z.ms >= 0 ? "+" : "") + (z.kmh - z.ms).toFixed(0) : ""}</td>
<td class="n t">${z.t.toTimeString().slice(0,5)}</td></tr>`).join("")}
</tbody></table></body></html>`, "utf8");
  console.log(`HTML geschrieben: ${HTML}`);
}
