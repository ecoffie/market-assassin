/** POTETO — Pursuit Dossier Truth. Fixture: VA 36C24226Q0857. Read-only. */
process.env.SAM_DOCS_READONLY='on';
import { buildPursuitDossier } from '../../src/mcp/tools/pursuit-dossier';
let pass=true; const chk=(n:string,ok:boolean,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)pass=false;};
const d:any = await buildPursuitDossier({ solicitation_number:'36C24226Q0857', client_name:'Poteto Test Co', userEmail:'eric@govcongiants.com' } as any);

// SOLICITATION
chk('SOLICITATION correct notice', d.opportunity?.solicitation_number==='36C24226Q0857' && d._meta?.naics==='236220',
  `${d.opportunity?.solicitation_number} naics=${d._meta?.naics} status=${d.opportunity?.status}`);
// INCUMBENT (P0 lock)
chk('INCUMBENT no unsupported incumbent', d.incumbent===null && d._meta?.grounded_incumbent===false);
chk('INCUMBENT AT&T never named', !/at&t/i.test(JSON.stringify(d.incumbent ?? {})));
// COMPETITION
chk('COMPETITION rule-of-two + caveats preserved',
  d.competition?.rule_of_two_met===true && Array.isArray(d.competition?.caveats) && d.competition.caveats.length>0,
  `depth=${d.competition?.market_depth} caveats=${d.competition?.caveats?.length} coverage=${d.competition?.sample_coverage?.toFixed?.(3)}`);
// CONTACT
const cs=d.buying_office_contacts||[];
const spivIdx=cs.findIndex((c:any)=>/spivack/i.test(String(c.contact_email||'')));
chk('CONTACT solicitation-named CO is present', spivIdx>=0, spivIdx>=0?`rank #${spivIdx+1}`:'ABSENT');
chk('CONTACT named CO outranks generic directory', spivIdx===0,
  cs.slice(0,3).map((c:any)=>`${c.contact_fullname}(${c.source??'directory'})`).join(' > '));
chk('CONTACT directory retained as fallback', cs.some((c:any)=>!c.source), `${cs.length} total`);
chk('CONTACT no duplicate emails', new Set(cs.map((c:any)=>String(c.contact_email||'').toLowerCase())).size===cs.filter((c:any)=>c.contact_email).length);
// PRICE
const na=String(d.price_to_win?._meta?.not_applicable||'');
chk('PRICE refusal preserved (no invented number)', d.price_to_win?.pricing===null && d.price_to_win?._meta?.grounded===false);
chk('PRICE reason is sector-accurate (Construction)', /Construction/.test(na) && !/manufacturing\/product\/wholesale/.test(na), na.slice(0,90));
// ACTION
chk('ACTION does not steer into the unverified extractor', !/extract_compliance_matrix/.test(String(d.next_step||'')), String(d.next_step||'').slice(0,110));
chk('ACTION is supported by dossier evidence', /evaluate_bid_decision/.test(String(d.next_step||'')));
// SHARE — N/A by contract
chk('SHARE is N/A (no hosted artifact promised)', d.deliverable===undefined || d.deliverable===null);
console.log(pass?'\n✅ POTETO — Pursuit Dossier Truth VERIFIED':'\n❌ FAILED');
process.exit(pass?0:1);
