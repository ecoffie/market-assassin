/**
 * BLIND CHAIN RERUN — North Star. No mention of Space Force, Vandenberg or SABER is given.
 * Assembles evidence via NS-1/NS-3/NS-2, then asks CHAIN-3 for a recommendation.
 *   npx tsx scripts/chain-northstar-blind.mts "Company Name"
 */
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const { lookupSamEntity } = await import('../src/mcp/tools/sam-entity');
const { resolveOperationalCustomer } = await import('../src/lib/gov-identity/operational-customer');
const { queryExpiringContracts } = await import('../src/lib/recompete/query');
const { recommendPursuits } = await import('../src/lib/decision/pursuit-recommendation');

const COMPANY = process.argv[2] || 'North Star Government Services';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const gaps: string[] = [];

// HOP 1 — identity (NS-1)
const id: any = await lookupSamEntity({ name: COMPANY } as any);
if (!id._meta.grounded) { console.log(`\n  cannot establish identity for ${COMPANY}\n`); process.exit(1); }
const e = id.entity;

// HOP 2 — demonstrated awards
// Paged to exhaustion. PostgREST caps a response at 1,000 rows, and a company with more
// awards than that would silently yield a PARTIAL history — CHAIN-3 would then recommend
// from a truncated view while looking complete. The evidence set must be whole or say so.
const won: Array<Record<string, any>> = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('recompete_opportunities')
    .select('piid,naics_code,potential_total_value,period_of_performance_current_end')
    .eq('incumbent_uei', e.ueiSAM)
    .order('potential_total_value', { ascending: false })
    .range(from, from + 999);
  if (error) { gaps.push(`award history unavailable: ${error.message}`); break; }
  won.push(...(data || []));
  if (!data || data.length < 1000) break;
}

// HOP 3 — operational customer per vehicle (NS-3)
const dodaacs = [...new Set(won.map((w) => String(w.piid).slice(0, 6).toUpperCase()).filter((d) => /^[A-Z][A-Z0-9]{5}$/.test(d)))];
const custByDodaac = new Map<string, any>();
for (const d of dodaacs) {
  const { data: dir } = await sb.from('dodaac_directory').select('office_name,updated_at').eq('dodaac', d).maybeSingle();
  const { data: n } = await sb.from('sam_opportunities').select('office_address,pop_city,department,sub_tier')
    .ilike('solicitation_number', `${d}%`).not('office_address->>city', 'is', null).limit(1);
  const oc = resolveOperationalCustomer({
    department: n?.[0]?.department, subTier: n?.[0]?.sub_tier,
    officeAddressCity: n?.[0]?.office_address?.city, popCity: n?.[0]?.pop_city,
    dodaac: d, contractingOfficeName: dir?.office_name ?? null, observedAt: dir?.updated_at ?? null,
  });
  custByDodaac.set(d, oc);
}

// HOP 4 — reachable recompetes on its OWN vehicles (NS-2)
const primaryNaics = won[0]?.naics_code || (e.naicsList || [])[0]?.naicsCode;
const anchored: any = await queryExpiringContracts({ naics: primaryNaics, months: 18, limit: 50, anchorPiidPrefixes: dodaacs } as any);
if (anchored.degraded) gaps.push('recompete retrieval degraded');

// HOP 5 — decision (CHAIN-3)
const rec = recommendPursuits({
  company: { name: e.legalBusinessName, uei: e.ueiSAM },
  identity: {
    registrationStatus: e.registrationStatus, naicsCodes: (e.naicsList || []).map((n: any) => n.naicsCode),
    has8a: e.has8a, hasHUBZone: e.hasHUBZone, hasWOSB: e.hasWOSB, hasSDVOSB: e.hasSDVOSB,
  },
  demonstrated: won.map((w) => {
    const oc = custByDodaac.get(String(w.piid).slice(0, 6).toUpperCase());
    return {
      piid: w.piid, naicsCode: w.naics_code, value: w.potential_total_value,
      endsOn: w.period_of_performance_current_end,
      customer: oc ? { component: oc.operational.component, unit: oc.operational.unit,
        installation: oc.operational.installation, divergesFromAdministrative: oc.divergesFromAdministrative } : null,
    };
  }),
  reachable: (anchored.contracts || [])
    .filter((c: any) => dodaacs.some((d) => String(c.piid || '').startsWith(d)))
    .map((c: any) => ({ piid: c.piid, incumbentName: c.incumbent_name, incumbentUei: c.incumbent_uei,
      naicsCode: c.naics_code, value: c.total_obligation, endsOn: c.period_of_performance_current_end,
      isOwnIncumbency: c.incumbent_uei === e.ueiSAM })),
  evidenceGaps: gaps,
});

console.log(`\n══════ WHAT SHOULD ${e.legalBusinessName} PURSUE NEXT, AND WHY? ══════\n`);
console.log('DEMONSTRATED — what they have proven:');
for (const c of rec.demonstratedProfile.customers) console.log(`  · ${c.label}: ${c.awards} award(s), $${Math.round(c.value).toLocaleString()}`);
console.log(`  total $${Math.round(rec.demonstratedProfile.totalValue).toLocaleString()} across NAICS ${rec.demonstratedProfile.naicsCodes.join(', ')}\n`);
if (rec.cannotAnswer) console.log(`CANNOT ANSWER: ${rec.cannotAnswer}\n`);
console.log(`RECOMMENDED PURSUITS (${rec.pursuits.length}):`);
rec.pursuits.forEach((p, i) => {
  console.log(`\n  ${i + 1}. ${p.what}   [${p.basis}]${p.value ? ` · $${Math.round(p.value).toLocaleString()}` : ''}`);
  console.log(`     WHY: ${p.why}`);
  for (const ev of p.evidence) console.log(`     evidence: ${ev}`);
});
if (rec.caveats.length) { console.log('\nCAVEATS:'); for (const c of rec.caveats) console.log(`  · ${c}`); }
console.log();
