// Prüfwerkzeug: listet eine Route kilometerweise auf und zeigt, mit welcher
// Geschwindigkeit an jedem Autobahnkilometer gerechnet wird – und warum.
//
// Aufruf:
//   node routenplaner/scripts/audit-route.mjs <korridor> [wunsch] [toleranz] [abfahrt] [--csv datei]
//   node routenplaner/scripts/audit-route.mjs koeln-muenchen 185 15 2026-08-11T08:00
//
// Die Rechenlogik ist bewusst identisch zu der in index.html; die Gesamtzeiten
// lassen sich damit gegen die Anzeige prüfen.

import { readFile, writeFile } from "node:fs/promises";

const [, , korridorId = "koeln-muenchen", wunschArg = "185", tolArg = "15", abfahrtArg = "2026-08-11T08:00", ...rest] =
  process.argv;
const WUNSCH = Number(wunschArg);
const TOLERANZ = Number(tolArg);
const ABFAHRT = new Date(abfahrtArg);
const csvIdx = rest.indexOf("--csv");
const CSV = csvIdx >= 0 ? rest[csvIdx + 1] : null;

const lade = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const routes = await lade("../data/routes.json");
const roadworks = await lade("../data/roadworks.json");
const traffic = await lade("../data/traffic.json");

// --- identisch zu index.html -------------------------------------------------
const HOURLY = [1.2,0.9,0.8,0.8,1.0,1.8,3.5,5.5,5.8,5.5,5.5,5.6,5.6,5.7,6.0,6.5,7.0,7.2,6.3,4.8,3.6,2.8,2.2,1.4];
const HOURLY_MEAN = HOURLY.reduce((a,b)=>a+b,0)/24;
const HOURLY_SV = [3.0,2.8,2.8,2.9,3.3,4.0,4.8,5.2,5.2,5.1,5.1,5.0,4.9,5.0,5.0,5.0,4.9,4.6,4.2,3.9,3.7,3.6,3.4,3.2];
const HOURLY_SV_MEAN = HOURLY_SV.reduce((a,b)=>a+b,0)/24;
const DICHTE_GEWICHT = 4.0, LKW_GEWICHT = 50.0, BLOCKIERT_FALLBACK = 60;

const welle = (tag,std) => (tag===5&&std>=14&&std<=19)?1.25:(tag===0&&std>=15&&std<=20)?1.20:1.0;
const tagTyp = (d) => d.getDay()===0?"sonntag":d.getDay()===6?"samstag":"werktag";

const rad = (d)=>d*Math.PI/180;
function distKm(aLat,aLon,bLat,bLon){
  const dLat=rad(bLat-aLat), dLon=rad(bLon-aLon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;
  return 2*6371*Math.asin(Math.sqrt(s));
}
const tIdx=new Map();
for(const s of traffic.stationen){
  const k=`${s.ref}|${Math.round(s.lat*4)}|${Math.round(s.lon*4)}`;
  if(!tIdx.has(k)) tIdx.set(k,[]);
  tIdx.get(k).push(s);
}
function verkehrAn(ref,lat,lon,typ){
  let best=null,bd=Infinity;
  const gi=Math.round(lat*4), gj=Math.round(lon*4);
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)
    for(const s of tIdx.get(`${ref}|${gi+di}|${gj+dj}`)||[]){
      const d=distKm(lat,lon,s.lat,s.lon);
      if(d<bd){bd=d;best=s;}
    }
  if(!best||bd>25) return null;
  const dirs=["ri1","ri2"].map(k=>best[k]).filter(Boolean);
  if(!dirs.length) return null;
  let kfz=0,sv=0,n=0,spuren=Infinity;
  for(const d of dirs){
    const t=d.tage[typ]||d.tage.mittel;
    if(!t) continue;
    kfz+=t[0]; sv+=t[1]; n++; spuren=Math.min(spuren,d.fs||2);
  }
  return n?{kfz:kfz/n,sv:sv/n,spuren:Math.max(1,spuren)}:null;
}
function praktisch(wunsch,t,d){
  if(!t) return wunsch;
  const h=d.getHours();
  const kfzStd=(t.kfz/24)*(HOURLY[h]/HOURLY_MEAN)*welle(d.getDay(),h);
  const svStd=(t.sv/24)*(HOURLY_SV[h]/HOURLY_SV_MEAN);
  const proSpur=kfzStd/t.spuren, svProSpur=svStd/t.spuren;
  const entlastung=t.spuren<2.5?1.0:t.spuren<3.5?0.45:0.25;
  return Math.max(90, wunsch - Math.pow(proSpur/1000,1.6)*DICHTE_GEWICHT - (svProSpur/100)*LKW_GEWICHT*entlastung);
}
function grenze(seg,tol){
  if(seg.maxspeedTag==="none") return null;
  if(typeof seg.maxspeedTag==="number") return seg.maxspeedTag+tol;
  if(seg.ref) return seg.fallbackSpeedKmh+tol;
  return seg.fallbackSpeedKmh;
}
const datumKey=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function fensterGilt(w,min){ return w.bisMin<=w.vonMin ? (min>=w.vonMin||min<w.bisMin) : (min>=w.vonMin&&min<w.bisMin); }
function aktivUm(item,d){
  const key=datumKey(d);
  if((item.ausnahmen||[]).includes(key)) return false;
  const w=item.windows||[];
  if(!w.length) return true;
  const min=d.getHours()*60+d.getMinutes(), tag=d.getDay();
  return w.some(x=> x.art==="datum" ? (x.datum===key&&fensterGilt(x,min))
    : x.art==="wochentage" ? (x.tage.includes(tag)&&key>=x.abDatum&&key<=x.bisDatum&&fensterGilt(x,min)) : false);
}
const wirkt=(i)=>Boolean(i.speedLimitKmh)||i.isBlocked;
function abdeckung(item,routeId){
  if(!item.lengthKm) return 1;
  const n=item.affects.filter(a=>a.routeId===routeId).length;
  return n?Math.min(1,item.lengthKm/n):1;
}
const fmt=(h)=>`${Math.floor(Math.round(h*60)/60)}h${String(Math.round(h*60)%60).padStart(2,"0")}`;

// --- Auswertung --------------------------------------------------------------
const korridor = routes.corridors.find(c=>c.id===korridorId);
if(!korridor){ console.error("Korridor unbekannt:", routes.corridors.map(c=>c.id).join(", ")); process.exit(1); }

console.log(`${korridor.name}   Wunsch ${WUNSCH} km/h, Toleranz +${TOLERANZ}, Abfahrt ${ABFAHRT.toLocaleString("de-DE")}`);
console.log("Verkehr eingerechnet: ja\n");

const csvZeilen = ["route;km;autobahn;osm_limit;baustelle_limit;basis;verkehrsgebremst;effektiv;uhrzeit"];

for(const route of korridor.routes){
  if(!route.segments?.length) continue;
  let t=0;
  const zeilen=[];
  route.segments.forEach((seg,i)=>{
    const km=seg.distanceMeters/1000;
    const zeit=new Date(ABFAHRT.getTime()+t*3600_000);
    const typ=tagTyp(zeit);
    const basis0=grenze(seg,TOLERANZ);
    const basis=basis0===null?WUNSCH:Math.min(WUNSCH,basis0);
    let nachVerkehr=basis;
    if(seg.ref){
      const tr=verkehrAn(seg.ref,seg.start.lat,seg.start.lon,typ);
      nachVerkehr=Math.min(basis,praktisch(WUNSCH,tr,zeit));
    }
    const treffer=roadworks.items.filter(it=>
      it.affects.some(a=>a.corridorId===korridor.id&&a.routeId===route.id&&a.segmentIndex===i)
      && aktivUm(it,zeit) && wirkt(it));
    let effektiv=nachVerkehr, bwLimit=null, anteil=0;
    if(treffer.length){
      bwLimit=Math.min(...treffer.map(x=>x.speedLimitKmh?x.speedLimitKmh+TOLERANZ:BLOCKIERT_FALLBACK));
      const bwTempo=Math.min(nachVerkehr,bwLimit);
      anteil=Math.max(...treffer.map(x=>abdeckung(x,route.id)));
      const gebremst=km*anteil, frei=km-gebremst;
      t+=gebremst/bwTempo+frei/nachVerkehr;
      effektiv=km/(gebremst/bwTempo+frei/nachVerkehr);   // Mischtempo dieses Kilometers
    } else {
      t+=km/nachVerkehr;
    }
    zeilen.push({i,ref:seg.ref,osm:seg.maxspeedTag,fb:seg.fallbackSpeedKmh,basis,nachVerkehr,effektiv,bwLimit,anteil,zeit});
    csvZeilen.push([route.id,i+1,seg.ref||"",seg.maxspeedTag==="none"?"frei":(seg.maxspeedTag??`(${seg.fallbackSpeedKmh})`),
      bwLimit??"",Math.round(basis),Math.round(nachVerkehr),Math.round(effektiv),
      zeit.toTimeString().slice(0,5)].join(";"));
  });

  // Gleichartige Kilometer zu Blöcken zusammenfassen
  const bloecke=[];
  for(const z of zeilen){
    const sig=`${z.ref}|${z.osm}|${Math.round(z.effektiv/5)*5}|${z.bwLimit}`;
    const letzter=bloecke[bloecke.length-1];
    if(letzter&&letzter.sig===sig){ letzter.bis=z.i; letzter.n++; }
    else bloecke.push({sig,von:z.i,bis:z.i,n:1,...z});
  }
  console.log(`── ${route.label}   ${fmt(t)}   ${(route.segments.reduce((a,s)=>a+s.distanceMeters,0)/1000).toFixed(0)} km`);
  console.log("   km          Autobahn  OSM-Limit   Baustelle   gerechnet");
  for(const b of bloecke){
    if(b.n<3 && b.ref) continue;                       // Rauschen ausblenden
    const spanne=b.n===1?`${b.von+1}`:`${b.von+1}–${b.bis+1}`;
    const osm=b.osm==="none"?"unbegrenzt":(b.osm??`~${b.fb} gesch.`);
    console.log(`   ${spanne.padEnd(11)} ${(b.ref||"Ort").padEnd(8)} ${String(osm).padEnd(11)} ${(b.bwLimit?b.bwLimit+" km/h":"–").padEnd(11)} ${Math.round(b.effektiv)} km/h`);
  }
  console.log("");
}

if(CSV){ await writeFile(CSV, csvZeilen.join("\n")+"\n","utf8"); console.log(`CSV geschrieben: ${CSV} (${csvZeilen.length-1} Zeilen)`); }
