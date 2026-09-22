import { resolveSolicitationIncumbent } from '../../src/lib/usaspending/solicitation-incumbent';
import { generateMarketReport } from '../../src/mcp/tools/market-report';
let pass = true; const chk=(n:string,ok:boolean,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)pass=false;};

// RC-3 — both real incidents
const va: any = await resolveSolicitationIncumbent('36C24226Q0857');
chk('RC-3 VA demolition: AT&T WiFi NOT named', va.incumbent === null, `certainty=${va._meta.incumbent_certainty}`);
chk('RC-3 VA demolition: not supported', va._meta.incumbent_certainty !== 'supported');
const dla: any = await resolveSolicitationIncumbent('SPE60525R0222');
chk('RC-3 DLA fuel: Lockheed PAC-3 NOT named', dla.incumbent === null, `certainty=${dla._meta.incumbent_certainty}`);
chk('RC-3 DLA fuel: sector conflict hard-rejected', dla._meta.incumbent_certainty === 'none');

// RC-2 — subject integrity
const OFF = ['339114','331491','314910','518210','339112'];
const dr: any = await generateMarketReport({ keyword:'drones', userEmail:'eric@govcongiants.com' } as any);
const drCodes = (dr.sections.recompetes.contracts||[]).map((c:any)=>String(c.naics_code));
chk('RC-2 drones: no off-subject recompetes', !drCodes.some((c:string)=>OFF.includes(c)), `naics=${[...new Set(drCodes)].join(',')}`);
const bc: any = await generateMarketReport({ keyword:'building construction and renovation', userEmail:'eric@govcongiants.com' } as any);
chk('RC-2 construction: no unrelated recompetes', (bc.sections.recompetes.contracts||[]).length === 0);

// RC-4 — deliverable gating
chk('RC-4 thin construction report withheld', bc.deliverable.url === null, `grounded=${bc._meta.sections_grounded}/${bc._meta.sections_total}`);
chk('RC-4 healthy drones report PUBLISHED', !!dr.deliverable.url, `grounded=${dr._meta.sections_grounded}/${dr._meta.sections_total}`);

// RC-5 — customer HTML clean
const sigs=['Chromium','lambda','puppeteer','Eric 2026','TODO','FIXME','src/lib/'];
const leaked = sigs.filter(s=>(dr.deliverable.html||'').includes(s));
chk('RC-5 no internal signatures in customer HTML', leaked.length===0, leaked.join(',')||'clean');
chk('RC-5 no HTML comments', ((dr.deliverable.html||'').match(/<!--[\s\S]*?-->/g)||[]).length===0);
console.log(pass?'\n✅ ALL FOUR ITEMS VERIFIED ON PRODUCTION FIXTURES':'\n❌ FAILED');
process.exit(pass?0:1);
