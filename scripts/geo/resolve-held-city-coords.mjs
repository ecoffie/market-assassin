#!/usr/bin/env node
/**
 * Individual review of the moves correct-city-coords.mjs HELD (> 25 km). The 25 km rule is NOT
 * relaxed; each held entry is classified on postal evidence and only PROVEN SAME PLACE changes.
 *
 * Evidence: GeoNames US postal codes (https://download.geonames.org/export/zip/US.zip, CC BY 4.0),
 * the same source the table was built from (each entry is the FIRST ZIP listed under that postal
 * name). The seed ZIP that produced the current point is excluded; the name's OTHER ZIPs are
 * the independent evidence, tested against the Census place boundary (cb_2024_us_place_500k).
 *
 *   PROVEN SAME PLACE        ≥ 2 other ZIPs and ≥ 60% of them in / within 3 km of the Census place
 *                            (or ≥ 60% within 10 km with none within 10 km of the seed ZIP — a
 *                            metro whose postal area spills past the city limit, e.g. Orlando)
 *   POSTAL/CENSUS AMBIGUITY  none of the name's ZIPs are at the Census place: the postal town is a
 *                            different place with the same name (Voorhees, NJ) — keep the postal point
 *   UNKNOWN                  anything else (typically one other ZIP) — keep
 *   WRONG STATE/PLACE        the current point lies outside the stated state — keep, report
 *
 * Usage: node scripts/geo/resolve-held-city-coords.mjs --postal <US.txt> --places <dir> [--write]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const POSTAL = arg('--postal'), PLACES = arg('--places'), WRITE = process.argv.includes('--write');
if (!POSTAL || !PLACES) { console.error('need --postal and --places'); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TABLE = path.join(ROOT, 'src/data/us-city-coords.json');
const MANIFEST = path.join(ROOT, 'data/geo/us-city-coords-corrections-2026-10-04.json');
// boundary reader (same as scripts/geo/correct-city-coords.mjs)
const dbf=fs.readFileSync(path.join(PLACES,'cb_2024_us_place_500k.dbf'));const nrec=dbf.readUInt32LE(4),hlen=dbf.readUInt16LE(8),rlen=dbf.readUInt16LE(10);
const fields=[];for(let o=32;dbf[o]!==0x0d;o+=32)fields.push({name:dbf.toString('latin1',o,o+11).replace(/\0.*$/,''),len:dbf[o+16]});
const geoids=[];for(let i=0;i<nrec;i++){let o=hlen+i*rlen+1,g='';for(const f of fields){if(f.name==='GEOID')g=dbf.toString('latin1',o,o+f.len).trim();o+=f.len;}geoids.push(g);}
const shp=fs.readFileSync(path.join(PLACES,'cb_2024_us_place_500k.shp'));const poly=new Map();let off=100,idx=0;
while(off<shp.length){const len=shp.readInt32BE(off+4)*2,c=off+8;if(shp.readInt32LE(c)===5){const np=shp.readInt32LE(c+36),npt=shp.readInt32LE(c+40);const parts=[];for(let i=0;i<np;i++)parts.push(shp.readInt32LE(c+44+4*i));const pb=c+44+4*np;const pts=new Float64Array(npt*2);for(let i=0;i<npt*2;i++)pts[i]=shp.readDoubleLE(pb+8*i);poly.set(geoids[idx],{parts,pts,npt});}idx++;off=c+len;}
const rings=(p,fn)=>{for(let k=0;k<p.parts.length;k++)fn(p.parts[k],k+1<p.parts.length?p.parts[k+1]:p.npt);};
const inPoly=(p,x,y)=>{let c=false;rings(p,(s,e)=>{for(let i=s,j=e-1;i<e;j=i++){const xi=p.pts[2*i],yi=p.pts[2*i+1],xj=p.pts[2*j],yj=p.pts[2*j+1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}});return c;};
const edgeKm=(p,x,y)=>{let b=Infinity;const kx=111.32*Math.cos(y*Math.PI/180),ky=110.57;rings(p,(s,e)=>{for(let i=s;i<e-1;i++){const ax=(p.pts[2*i]-x)*kx,ay=(p.pts[2*i+1]-y)*ky,bx=(p.pts[2*i+2]-x)*kx,by=(p.pts[2*i+3]-y)*ky;const dx=bx-ax,dy=by-ay;const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/((dx*dx+dy*dy)||1)));b=Math.min(b,Math.hypot(ax+t*dx,ay+t*dy));}});return b;};
const near=(p,ll)=>inPoly(p,ll[1],ll[0])||edgeKm(p,ll[1],ll[0])<=3;
const km=(a,b)=>{const r=Math.PI/180;const x=Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2;return 2*6371*Math.asin(Math.sqrt(x));};
const norm=s=>s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\./g,'').replace(/'/g,'').replace(/-/g,' ').replace(/\s+/g,' ').trim();
const zipsBy=new Map();
for(const l of fs.readFileSync(POSTAL,'utf8').split('\n')){const f=l.split('\t');if(f.length<11)continue;const k=norm(f[2])+'|'+f[4];(zipsBy.get(k)||zipsBy.set(k,[]).get(k)).push({zip:f[1],ll:[+f[9],+f[10]]});}

const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
const table=JSON.parse(fs.readFileSync(TABLE,'utf8'));
const pending=manifest.held_review ? manifest.held_review.map((r)=>({key:r.key,from:r.from,to:r.to,move_km:r.move_km,place:r.place,geoid:r.geoid})) : manifest.held;
const review=[];const counts={};
for(const h of pending){
  const p=poly.get(h.geoid); const z=zipsBy.get(h.key)||[];
  const seed=z.filter(q=>km(q.ll,h.from)<0.05); const others=z.filter(q=>km(q.ll,h.from)>=0.05);
  const inPlace=others.filter(q=>near(p,q.ll)).length;
  const within10=others.filter(q=>inPoly(p,q.ll[1],q.ll[0])||edgeKm(p,q.ll[1],q.ll[0])<=10).length;
  let cls, why;
  if(!z.length){cls='UNKNOWN';why='no postal ZIP carries this name';}
  else if(others.length>=2 && inPlace>=0.6*others.length){cls='PROVEN SAME PLACE';why=`${inPlace}/${others.length} of the name's other ZIPs lie in/at the Census place; seed ZIP${seed.map(s=>' '+s.zip).join(',')} is the outlier`;}
  else if(others.length>=2 && within10>=0.6*others.length && others.every(q=>km(q.ll,h.from)>10)){cls='PROVEN SAME PLACE';why=`${within10}/${others.length} of the name's other ZIPs lie within 10 km of the Census place (${inPlace} inside); none within 10 km of seed ZIP${seed.map(s=>' '+s.zip).join(',')}`;}
  else if(z.every(q=>!near(p,q.ll))){cls='POSTAL/CENSUS AMBIGUITY';why=`none of the name's ${z.length} ZIP(s) are at the Census place — a different place with the same name`;}
  else {cls='UNKNOWN';why=`mixed: ${inPlace}/${others.length} other ZIPs at the Census place`;}
  counts[cls]=(counts[cls]||0)+1;
  review.push({...h,cls,why});
  if(cls==='PROVEN SAME PLACE') table[h.key]=h.to;
}
console.log(counts);
for(const r of review.filter(r=>r.cls==='PROVEN SAME PLACE')) console.log(`  ${r.key}: ${r.from} -> ${r.to} (${r.move_km} km) — ${r.why}`);
if(WRITE){
  manifest.held_review=review;
  manifest.held=review.filter(r=>r.cls!=='PROVEN SAME PLACE').map(({cls,why,...r})=>r);
  manifest.held_resolved=review.filter(r=>r.cls==='PROVEN SAME PLACE').map(({cls,why,...r})=>({...r,evidence:why}));
  fs.writeFileSync(MANIFEST,JSON.stringify(manifest));
  fs.writeFileSync(TABLE,JSON.stringify(table));
  console.log('wrote table + manifest (held_review, held_resolved)');
}
