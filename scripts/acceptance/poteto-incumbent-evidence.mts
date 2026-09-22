/**
 * POTETO — Incumbent Evidence Truth. Live, read-only.
 *   CANDIDATES → EVIDENCE → SCORE → CONFIDENCE → SELECTION → EXPLANATION
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/acceptance/poteto-incumbent-evidence.mts
 *
 * Negatives: VA demolition 36C24226Q0857 (AT&T guest WiFi), DLA fuel SPE60525R0222
 * (Lockheed PAC-3). Positives: real recompetes the matcher gets right today.
 */
process.env.SAM_DOCS_READONLY = 'on';
import { resolveSolicitationIncumbent } from '../../src/lib/usaspending/solicitation-incumbent';
import { findPredecessor } from '../../src/mcp/tools/predecessor-award';
import { buildPursuitDossier } from '../../src/mcp/tools/pursuit-dossier';

let pass = true;
const chk = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) pass = false; };
const row = (h: any) => `${h.recipientName} ${h.naicsCode}/${h.pscCode} n=${h.naicsMatch} p=${h.pscMatch} ${h.noticeSector}/${h.awardSector} ${h.matchConfidence} ${Math.round(h.matchScore)} ${h.confidenceConstraint ?? '-'} ${h.incumbent_certainty}`;

// A candidate's confidence must agree with its own structured evidence.
function consistent(h: any): boolean {
  const conflict = !!h.noticeSector && !!h.awardSector && h.noticeSector !== h.awardSector;
  if (conflict && h.matchConfidence !== 'low') return false;
  if (!h.naicsMatch && !h.pscMatch && h.matchConfidence === 'high') return false;
  return true;
}

// ── Fixture A — VA demolition ────────────────────────────────────────────────
const va: any = await resolveSolicitationIncumbent('36C24226Q0857');
for (const h of va.prior_awards) console.log('   VA cand:', row(h));
chk('1 VA: AT&T is not the incumbent', va.incumbent === null && !/at&t/i.test(JSON.stringify(va.incumbent ?? {})));
const att = va.prior_awards.find((h: any) => /AT&T/i.test(h.recipientName));
chk('2 VA: AT&T candidate not high on dual NAICS+PSC mismatch', !!att && att.matchConfidence !== 'high', att ? row(att) : 'AT&T candidate absent');
chk('3 VA: sector 23 vs 51 is represented in confidence', !!att && att.matchConfidence === 'low' && att.confidenceConstraint === 'sector_conflict');
chk('9 VA: every candidate’s confidence agrees with its evidence', va.prior_awards.every(consistent),
  va.prior_awards.filter((h: any) => !consistent(h)).map(row).join(' | '));
chk('10 VA: final selection still conservative', va._meta.grounded_incumbent === false && va._meta.incumbent_certainty !== 'supported');

// Geography-only overlap ("East Orange", "Lyons") cannot manufacture high confidence.
const geoOnly = va.prior_awards.filter((h: any) => !h.naicsMatch && !h.pscMatch);
chk('6 generic/geographic token overlap cannot create high confidence', geoOnly.length > 0 && geoOnly.every((h: any) => h.matchConfidence !== 'high'),
  `${geoOnly.length} title-only candidates`);

// The entry point that never ran the guard.
const vaPred: any = await findPredecessor({ naics_code: '236220', agency_name: 'VETERANS AFFAIRS, DEPARTMENT OF', title: 'Z1DA--VANJHCS Demolition and Abatement IDIQ East Orange and Lyons' });
chk('1b find_predecessor_award: AT&T not presented as likely incumbent', vaPred.incumbent === null && vaPred._meta.grounded === false,
  vaPred.summary ?? 'no incumbent');

// ── Fixture B — DLA fuel ─────────────────────────────────────────────────────
const dla: any = await resolveSolicitationIncumbent('SPE60525R0222');
for (const h of dla.prior_awards) console.log('   DLA cand:', row(h));
chk('4 DLA: Lockheed PAC-3 is not the incumbent', dla.incumbent === null && !/lockheed/i.test(JSON.stringify(dla.incumbent ?? {})));
const lm = dla.prior_awards.find((h: any) => /lockheed/i.test(h.recipientName));
chk('5 DLA: no Lockheed candidate carries high confidence', !lm || lm.matchConfidence !== 'high',
  lm ? row(lm) : `not a candidate in current data (${dla.prior_awards.length} candidates)`);
chk('9 DLA: every candidate’s confidence agrees with its evidence', dla.prior_awards.every(consistent));
const dlaPred: any = await findPredecessor({ naics_code: '324110', agency_name: 'DEFENSE LOGISTICS AGENCY', title: '3.22 COG 2 Northeastern United States' });
chk('4b find_predecessor_award: no Lockheed for DLA fuel', !/lockheed/i.test(JSON.stringify(dlaPred.incumbent ?? {})), dlaPred.summary ?? 'no incumbent');

// ── Positive controls — the good candidate survives ─────────────────────────
const POS: Array<[string, RegExp]> = [
  ['W912EP26BA011', /WEEKS MARINE/i],               // Palm Beach Harbor maintenance dredging
  ['1240BE26Q0111', /AMERICLEAN/i],                 // NRS St Paul janitorial
  ['W15QKN-26-Q-A110', /JOLIVA/i],                  // Grounds maintenance, WV
];
for (const [sol, who] of POS) {
  const r: any = await resolveSolicitationIncumbent(sol);
  const top = r.prior_awards[0];
  if (top) console.log(`   POS ${sol}:`, row(top));
  chk(`7 positive ${sol}: supported incumbent survives`, !!r.incumbent && who.test(r.incumbent.recipientName) && r._meta.incumbent_certainty === 'supported',
    r.incumbent ? `${r.incumbent.recipientName} [${r.incumbent.matchConfidence}]` : `NOT NAMED (${r._meta.incumbent_reason})`);
  chk(`9 positive ${sol}: confidence agrees with evidence`, r.prior_awards.every(consistent));
}
const posPred: any = await findPredecessor({ naics_code: '237990', agency_name: 'Department of Defense', title: 'Palm Beach Harbor Maintenance Dredging, Entrance Channel and Settling Basin' });
chk('7b find_predecessor_award: positive still returned', !!posPred.incumbent && posPred._meta.grounded === true,
  posPred.summary ?? 'none');

// ── Financials guard — unsupported candidates never reach EDGAR ─────────────
const d: any = await buildPursuitDossier({ solicitation_number: '36C24226Q0857', client_name: 'Poteto Test Co', userEmail: 'eric@govcongiants.com' } as any);
chk('8 financials do not run for unsupported candidates', d.incumbent_financials === null && d._meta?.sections?.financials === false && d._meta?.grounded_incumbent === false);

console.log(pass ? '\n✅ POTETO — Incumbent Evidence Truth VERIFIED' : '\n❌ FAILED');
process.exit(pass ? 0 : 1);
