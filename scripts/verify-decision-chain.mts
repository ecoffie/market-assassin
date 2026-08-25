/**
 * DECISION-CHAIN BEHAVIORAL GATE — the two fixtures, frozen.
 *
 * These are NOT unit tests. They run the REAL chain against LIVE data and assert on the
 * DECISION, because every defect in this sprint was invisible to component tests: each
 * local piece looked plausible while the end-to-end answer was wrong.
 *
 * What this gate has already caught, in one run:
 *   · "FPO" — a Fleet Post Office MAIL CODE — presented as a customer
 *   · an un-ranged award query that would silently truncate a >1,000-award history
 *
 * NORTH STAR must keep surfacing the Space Launch Delta 30 / SABER relationship. A live
 * session once read FA4610 as "an Air Force SABER" and moved on; the whole NS-1/NS-2/NS-3
 * chain exists so that cannot recur.
 *
 * FLUIDYNE must keep reasoning from REAL award history. It once drifted into ammunition
 * and guided-missile NAICS with Boeing and Raytheon as "competitors" for a $20M
 * fluid-power manufacturer, because the decision layer re-derived the market from
 * free-text keywords instead of the award rows sitting right there.
 *
 *   npx tsx scripts/verify-decision-chain.mts
 *   npx tsx scripts/verify-decision-chain.mts --company "Some Company"   # explore only
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const { lookupSamEntity } = await import('../src/mcp/tools/sam-entity');
const { resolveOperationalCustomer } = await import('../src/lib/gov-identity/operational-customer');
const { queryExpiringContracts } = await import('../src/lib/recompete/query');
const { recommendPursuits } = await import('../src/lib/decision/pursuit-recommendation');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) fail++; console.log(`    ${c ? '✓' : '✗'} ${m}`); };

/** Run the whole chain blind — the caller supplies only a company name. */
async function runChain(company: string) {
  const gaps: string[] = [];
  const id: any = await lookupSamEntity({ name: company } as any);
  if (!id._meta.grounded) return null;
  const e = id.entity;

  const won: Array<Record<string, any>> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('recompete_opportunities')
      .select('piid,naics_code,potential_total_value,period_of_performance_current_end')
      .eq('incumbent_uei', e.ueiSAM).order('potential_total_value', { ascending: false })
      .range(from, from + 999);
    if (error) { gaps.push(`award history unavailable: ${error.message}`); break; }
    won.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const dodaacs = [...new Set(won.map((w) => String(w.piid).slice(0, 6).toUpperCase()).filter((d) => /^[A-Z][A-Z0-9]{5}$/.test(d)))];
  const cust = new Map<string, any>();
  for (const d of dodaacs) {
    const { data: dir } = await sb.from('dodaac_directory').select('office_name,updated_at').eq('dodaac', d).maybeSingle();
    const { data: n } = await sb.from('sam_opportunities').select('office_address,pop_city,department,sub_tier')
      .ilike('solicitation_number', `${d}%`).not('office_address->>city', 'is', null).limit(1);
    cust.set(d, resolveOperationalCustomer({
      department: n?.[0]?.department, subTier: n?.[0]?.sub_tier,
      officeAddressCity: n?.[0]?.office_address?.city, popCity: n?.[0]?.pop_city,
      dodaac: d, contractingOfficeName: dir?.office_name ?? null, observedAt: dir?.updated_at ?? null,
    }));
  }

  const primaryNaics = won[0]?.naics_code || (e.naicsList || [])[0]?.naicsCode;
  const anchored: any = await queryExpiringContracts({ naics: primaryNaics, months: 18, limit: 50, anchorPiidPrefixes: dodaacs } as any);
  if (anchored.degraded) gaps.push('recompete retrieval degraded');

  const rec = recommendPursuits({
    company: { name: e.legalBusinessName, uei: e.ueiSAM },
    identity: { registrationStatus: e.registrationStatus, naicsCodes: (e.naicsList || []).map((n: any) => n.naicsCode),
      has8a: e.has8a, hasHUBZone: e.hasHUBZone, hasWOSB: e.hasWOSB, hasSDVOSB: e.hasSDVOSB },
    demonstrated: won.map((w) => {
      const oc = cust.get(String(w.piid).slice(0, 6).toUpperCase());
      return { piid: w.piid, naicsCode: w.naics_code, value: w.potential_total_value, endsOn: w.period_of_performance_current_end,
        customer: oc ? { component: oc.operational.component, unit: oc.operational.unit,
          installation: oc.operational.installation, divergesFromAdministrative: oc.divergesFromAdministrative } : null };
    }),
    reachable: (anchored.contracts || []).filter((c: any) => dodaacs.some((d) => String(c.piid || '').startsWith(d)))
      .map((c: any) => ({ piid: c.piid, incumbentName: c.incumbent_name, incumbentUei: c.incumbent_uei,
        naicsCode: c.naics_code, value: c.total_obligation, endsOn: c.period_of_performance_current_end,
        isOwnIncumbency: c.incumbent_uei === e.ueiSAM })),
    evidenceGaps: gaps,
  });
  return { entity: e, rec, awards: won, dodaacs };
}

/** Assertions every company must satisfy — the architecture, not the fixture. */
function universalChecks(label: string, out: NonNullable<Awaited<ReturnType<typeof runChain>>>) {
  const blob = JSON.stringify(out.rec);
  ok(!/\b(APO|FPO|DPO)\b/.test(blob), `${label}: no mail code presented as a customer`);
  ok(!out.rec.pursuits.some((p) => !p.evidence.length), `${label}: every pursuit cites evidence`);
  ok(!out.rec.pursuits.some((p) => p.basis === 'adjacent' && !out.awards.length),
     `${label}: no "adjacent" pursuit without demonstrated history`);
  const claimed = /SDVOSB/.test(blob);
  ok(!claimed || out.entity.hasSDVOSB === true, `${label}: no certification claimed without affirming evidence`);
}

const explore = process.argv.indexOf('--company');
if (explore >= 0) {
  const name = process.argv[explore + 1];
  const out = await runChain(name);
  if (!out) { console.log(`\n  could not establish identity for "${name}"\n`); process.exit(1); }
  console.log(`\n  ${out.entity.legalBusinessName} — ${out.awards.length} award(s), ${out.rec.pursuits.length} pursuit(s)`);
  for (const c of out.rec.demonstratedProfile.customers) console.log(`    · ${c.label}: ${c.awards} award(s), $${Math.round(c.value).toLocaleString()}`);
  for (const p of out.rec.pursuits.slice(0, 3)) console.log(`    ${p.what}`);
  console.log();
  universalChecks(name, out);
  process.exit(fail ? 1 : 0);
}

console.log('\n  ══ DECISION-CHAIN BEHAVIORAL GATE ══\n');

// ── FIXTURE 1: NORTH STAR — the SABER / Space Launch Delta 30 relationship ──
console.log('  NORTH STAR GOVERNMENT SERVICES');
const ns = await runChain('North Star Government Services');
if (!ns) { console.log('    ✗ identity could not be established'); fail++; }
else {
  const blob = JSON.stringify(ns.rec);
  ok(blob.includes('Space Launch Delta 30'), 'surfaces Space Launch Delta 30 (not "Air Force")');
  ok(ns.rec.demonstratedProfile.customers.some((c) => c.label === 'Space Launch Delta 30'),
     'Space Launch Delta 30 appears as a demonstrated customer');
  ok(ns.rec.pursuits.some((p) => p.what.includes('FA461025F0190')), 'its own SABER task order is recommended');
  ok(ns.rec.pursuits[0]?.basis === 'demonstrated', 'the top pursuit rests on demonstrated evidence');
  ok(ns.rec.caveats.join(' ').includes('administrative hierarchy'),
     'the administrative-vs-operational divergence is surfaced');
  universalChecks('north star', ns);
}

// ── FIXTURE 2: FLUIDYNE — reasoning from real award history ──
console.log('\n  FLUIDYNE CORPORATION');
const fl = await runChain('Fluidyne Corporation');
if (!fl) { console.log('    ✗ identity could not be established'); fail++; }
else {
  const naics = fl.rec.demonstratedProfile.naicsCodes;
  const blob = JSON.stringify(fl.rec);
  ok(fl.awards.length >= 20, `reasons from real award history (${fl.awards.length} awards)`);
  ok(naics.includes('332911') || naics.includes('332919'), `uses its REAL award NAICS (${naics.slice(0, 4).join(', ')})`);
  // The exact drift that made the original answer wrong.
  ok(!naics.includes('332993') && !naics.includes('336414'),
     'does NOT drift into ammunition / guided-missile NAICS');
  ok(!/BOEING|RAYTHEON|NORTHROP|GENERAL DYNAMICS/i.test(blob),
     'does NOT present multi-billion primes as its peers');
  ok(fl.rec.demonstratedProfile.totalValue > 1_000_000, `demonstrated value grounded ($${Math.round(fl.rec.demonstratedProfile.totalValue).toLocaleString()})`);
  universalChecks('fluidyne', fl);
}

console.log(fail ? `\n  ✗ ${fail} CHECK(S) FAILED — the decision chain regressed\n` : '\n  ✓ DECISION CHAIN VERIFIED\n');
process.exit(fail ? 1 : 0);
