// Rechenkern des Verkehrsmodells als eigenständige Datei: welches Tempo ist auf
// einem Autobahnkilometer zu einer bestimmten Uhrzeit praktisch fahrbar?
//
// Läuft unverändert im Browser (window.LinkeSpurModell) und in Node (require).
// Genutzt von der Fahrtauswertung (fahrt/index.html) und von
// scripts/abgleich-fahrt.mjs. index.html und scripts/audit-route.mjs tragen
// dieselbe Logik noch als eigene Kopie – wer dort Koeffizienten ändert, muss es
// hier nachziehen (und umgekehrt), bis beide ebenfalls auf diese Datei umziehen.
//
// Nicht enthalten sind Baustellen: die hängen an hinterlegten Routen und ihrem
// Tagesstand, nicht am einzelnen Kilometer.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LinkeSpurModell = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Koeffizienten – Herkunft und Belege im README, Abschnitt Kalibrierung.
  const K = {
    DICHTE: 4.0,
    LKW: 15.0,
    ENTLASTUNG_2: 2.0,
    ENTLASTUNG_3: 0.1,
    ENTLASTUNG_4: 0.05,
    REFERENZ_TEMPO: 185,
    UNTERGRENZE: 90,
    ANLAGE_ANTEIL: 0.2,
    ANLAGE_TEMPO: 120,
    BESCHL_FAKTOR: 0.7,
    BESCHL_MIN: 15,
  };

  // Anteil des Tagesverkehrs je Stunde (Modellannahme, siehe index.html).
  const HOURLY = [1.2,0.9,0.8,0.8,1.0,1.8,3.5,5.5,5.8,5.5,5.5,5.6,5.6,5.7,6.0,6.5,7.0,7.2,6.3,4.8,3.6,2.8,2.2,1.4];
  const HOURLY_MEAN = HOURLY.reduce((a, b) => a + b, 0) / 24;
  const HOURLY_SV = [3.0,2.8,2.8,2.9,3.3,4.0,4.8,5.2,5.2,5.1,5.1,5.0,4.9,5.0,5.0,5.0,4.9,4.6,4.2,3.9,3.7,3.6,3.4,3.2];
  const HOURLY_SV_MEAN = HOURLY_SV.reduce((a, b) => a + b, 0) / 24;

  const welle = (tag, std) =>
    (tag === 5 && std >= 14 && std <= 19) ? 1.25 : (tag === 0 && std >= 15 && std <= 20) ? 1.20 : 1.0;
  const tagTyp = (d) => (d.getDay() === 0 ? "sonntag" : d.getDay() === 6 ? "samstag" : "werktag");

  const rad = (d) => (d * Math.PI) / 180;
  function distKm(aLat, aLon, bLat, bLon) {
    const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(s));
  }

  // Zählstellen-Suche: liefert eine Funktion (ref, lat, lon, tagTyp) ->
  // { kfz, sv, spuren } oder null, wenn im Umkreis von 25 km keine steht.
  function verkehrsIndex(stationen) {
    const idx = new Map();
    for (const s of stationen || []) {
      const k = `${s.ref}|${Math.round(s.lat * 4)}|${Math.round(s.lon * 4)}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(s);
    }
    return function verkehrAn(ref, lat, lon, typ) {
      let best = null, bd = Infinity;
      const gi = Math.round(lat * 4), gj = Math.round(lon * 4);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++)
        for (const s of idx.get(`${ref}|${gi + di}|${gj + dj}`) || []) {
          const d = distKm(lat, lon, s.lat, s.lon);
          if (d < bd) { bd = d; best = s; }
        }
      if (!best || bd > 25) return null;
      const dirs = ["ri1", "ri2"].map((k) => best[k]).filter(Boolean);
      if (!dirs.length) return null;
      let kfz = 0, sv = 0, n = 0, spuren = Infinity;
      for (const d of dirs) {
        const t = d.tage[typ] || d.tage.mittel;
        if (!t) continue;
        kfz += t[0]; sv += t[1]; n++; spuren = Math.min(spuren, d.fs || 2);
      }
      return n ? { kfz: kfz / n, sv: sv / n, spuren: Math.max(1, spuren) } : null;
    };
  }

  // Fahrstreifen je Richtung aus dem Raster (speedgrid.json, Feld spuren):
  // liefert eine Funktion (ref, lat, lon) -> Zahl oder null.
  function spurIndex(speedgrid) {
    const g = new Map();
    for (const [ref, flat] of Object.entries(speedgrid?.spuren || {})) {
      let la = 0, lo = 0;
      for (let i = 0; i < flat.length; i += 3) {
        la += flat[i]; lo += flat[i + 1];
        g.set(`${ref}|${la}|${lo}`, flat[i + 2]);
      }
    }
    const aufl = speedgrid?.grid || 200;
    return function spurenAn(ref, lat, lon) {
      if (!ref || !g.size) return null;
      const la = Math.round(lat * aufl), lo = Math.round(lon * aufl);
      let hit = null, bestD = 99;
      for (let d1 = -1; d1 <= 1; d1++) for (let d2 = -1; d2 <= 1; d2++) {
        const v = g.get(`${ref}|${la + d1}|${lo + d2}`);
        if (v === undefined) continue;
        const d = Math.abs(d1) + Math.abs(d2);
        if (d < bestD) { bestD = d; hit = v; }
      }
      return hit;
    };
  }

  // Praktisch fahrbares Tempo bei gegebenem Verkehr t = { kfz, sv, spuren }.
  function praktisch(wunsch, t, d, k = K) {
    if (!t) return wunsch;
    const h = d.getHours();
    const kfzStd = (t.kfz / 24) * (HOURLY[h] / HOURLY_MEAN) * welle(d.getDay(), h);
    const svStd = (t.sv / 24) * (HOURLY_SV[h] / HOURLY_SV_MEAN);
    const proSpur = kfzStd / t.spuren, svProSpur = svStd / t.spuren;
    const entlastung = t.spuren < 2.5 ? k.ENTLASTUNG_2 : t.spuren < 3.5 ? k.ENTLASTUNG_3 : k.ENTLASTUNG_4;
    const abzug = Math.pow(proSpur / 1000, 1.6) * k.DICHTE + (svProSpur / 100) * k.LKW * entlastung;
    return Math.max(k.UNTERGRENZE, wunsch - abzug * (wunsch / k.REFERENZ_TEMPO));
  }

  // Erwartungswert unter einer Wechselanzeige über sonst unbegrenzter Strecke.
  const anlageGrenze = (wunsch, k = K) => k.ANLAGE_ANTEIL * k.ANLAGE_TEMPO + (1 - k.ANLAGE_ANTEIL) * wunsch;

  // Zeitzuschlag (Stunden) für das Beschleunigen von vorher auf nachher km/h.
  function beschlZuschlagStd(vorher, nachher, k = K) {
    if (!vorher || !nachher || nachher <= vorher) return 0;
    const dv = nachher - vorher;
    return dv < k.BESCHL_MIN ? 0 : (k.BESCHL_FAKTOR * dv * dv) / nachher / 3600;
  }

  // Ein Autobahnkilometer ohne Baustelle: limit = null (unbegrenzt) oder km/h.
  // Liefert das gerechnete Tempo und die verwendete Spurzahl.
  function tempoFuerKm({ ref, lat, lon, limit, anlage, zeit, wunsch, toleranz = 0 }, quellen, k = K) {
    let basis = limit === null ? wunsch : Math.min(wunsch, limit + toleranz);
    if (limit === null && anlage) basis = Math.min(basis, anlageGrenze(wunsch, k));
    let tr = quellen.verkehrAn ? quellen.verkehrAn(ref, lat, lon, tagTyp(zeit)) : null;
    const osm = quellen.spurenAn ? quellen.spurenAn(ref, lat, lon) : null;
    if (tr && osm !== null) tr = { ...tr, spuren: osm };
    return { tempo: Math.min(basis, praktisch(wunsch, tr, zeit, k)), spuren: tr ? Math.round(tr.spuren) : osm };
  }

  return { K, tagTyp, welle, distKm, verkehrsIndex, spurIndex, praktisch, anlageGrenze, beschlZuschlagStd, tempoFuerKm };
});
