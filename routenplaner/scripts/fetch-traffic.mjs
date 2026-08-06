// Holt die Jahresauswertung der automatischen Dauerzählstellen der Bundesanstalt
// für Straßenwesen (BASt) und baut daraus einen kompakten Datensatz mit
// Verkehrsstärke, Schwerverkehrsanteil und Fahrstreifenzahl je Autobahn-Zählstelle.
//
// Warum das wichtig ist: Tempolimits allein erklären nicht, wie schnell man
// wirklich vorankommt. Eine zweispurige Autobahn mit hohem LKW-Anteil (A61) bremst
// auch ohne Limit, weil überholende LKW beide Spuren blockieren – eine dreispurige
// mit wenig Schwerverkehr (A9) nicht.
//
// Entscheidend ist die Aufschlüsselung nach Tagestyp: am Sonntag gilt das
// LKW-Fahrverbot, der Schwerverkehr bricht dort um rund 80 % ein.
//
// Läuft selten (Daten erscheinen jährlich) – siehe
// .github/workflows/routenplaner-traffic.yml.

import { writeFile } from "node:fs/promises";

// Jahresauswertung; das jeweils aktuellste verfügbare Jahr wird automatisch gesucht.
const BASE = "https://www.bast.de/DE/Themen/Digitales/HF_1/Massnahmen/verkehrszaehlung/Daten";
const USER_AGENT =
  "Mozilla/5.0 (compatible; AutobahnRoutenplaner/1.0; personal project) Node.js";
const REQUEST_TIMEOUT_MS = 120_000;

function jaweUrl(year) {
  return `${BASE}/${year}_1/Jawe${year}.csv?view=renderTcDataExportCSV`;
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Die BASt liefert Latin-1, nicht UTF-8.
    const buf = await res.arrayBuffer();
    return new TextDecoder("latin1").decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

// Deutsche Zahlformatierung: "53.006" = 53006, "15,1" = 15.1
function num(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(";").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(";");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

// Tagestypen der BASt-Auswertung. Der Schwerverkehr unterscheidet sich hier am
// stärksten (Sonntagsfahrverbot), deshalb wird je Typ separat abgelegt.
const DAY_TYPES = [
  { key: "werktag", kfz: "DTV_Kfz_W", sv: "DTV_SV_W" },
  { key: "samstag", kfz: "DTV_Kfz_WU_Sa", sv: "DTV_SV_WU_Sa" },
  { key: "sonntag", kfz: "DTV_Kfz_S", sv: "DTV_SV_S" },
  { key: "urlaub", kfz: "DTV_Kfz_U", sv: "DTV_SV_U" },
  { key: "mittel", kfz: "DTV_Kfz_MobisSo", sv: "DTV_SV_MobisSo" },
];

function buildStation(row) {
  const lat = num(row["Koor_WGS84_N"]);
  const lon = num(row["Koor_WGS84_E"]);
  if (lat === null || lon === null) return null;

  const station = {
    ref: "A" + (row["Str_Nr"] || "").trim(),
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
    name: (row["DZ_Name"] || "").trim(),
  };

  let hasAny = false;
  for (const ri of ["Ri1", "Ri2"]) {
    const lanes = num(row[`Anz_Fs_${ri}`]);
    if (!lanes) continue;
    const tage = {};
    for (const dt of DAY_TYPES) {
      const kfz = num(row[`${dt.kfz}_${ri}`]);
      const sv = num(row[`${dt.sv}_${ri}`]);
      if (kfz) tage[dt.key] = [Math.round(kfz), Math.round(sv || 0)];
    }
    if (!Object.keys(tage).length) continue;
    hasAny = true;
    station[ri.toLowerCase()] = {
      fs: Math.round(lanes),
      // Fernziel benennt die Fahrtrichtung dieser Zählrichtung, z.B. "Köln".
      ziel: (row[`Fernziel_${ri}`] || "").trim(),
      tage,
    };
  }
  return hasAny ? station : null;
}

async function main() {
  // Neuestes verfügbares Jahr suchen (Veröffentlichung erfolgt mit Verzug).
  const thisYear = new Date().getFullYear();
  let text = null;
  let usedYear = null;
  for (let y = thisYear; y >= thisYear - 3; y--) {
    try {
      console.log(`Versuche Jahresauswertung ${y} …`);
      const t = await fetchCsv(jaweUrl(y));
      if (t.includes("DTV_Kfz_MobisSo_Ri1")) {
        text = t;
        usedYear = y;
        break;
      }
    } catch (err) {
      console.log(`  ${y} nicht verfügbar (${err.message})`);
    }
  }
  if (!text) throw new Error("Keine BASt-Jahresauswertung abrufbar");

  const rows = parseCsv(text);
  const stations = [];
  for (const row of rows) {
    if ((row["Str_Kl"] || "").trim() !== "A") continue;
    if (!/^\d+$/.test((row["Str_Nr"] || "").trim())) continue;
    const s = buildStation(row);
    if (s) stations.push(s);
  }

  const output = {
    quelle: `BASt Jahresauswertung ${usedYear} (automatische Dauerzählstellen)`,
    jahr: usedYear,
    updatedAt: new Date().toISOString(),
    stationen: stations,
  };

  await writeFile(
    new URL("../data/traffic.json", import.meta.url),
    JSON.stringify(output) + "\n",
    "utf-8"
  );
  console.log(`traffic.json geschrieben: ${stations.length} Zählstellen (${usedYear}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
