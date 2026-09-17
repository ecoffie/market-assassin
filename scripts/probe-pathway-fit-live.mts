/**
 * Live PATHWAY FIT probes A/B/C + two-sided evidence deletion.
 *
 * Usage: npx tsx scripts/probe-pathway-fit-live.mts
 *
 * Companies are chosen for relevant public federal history in the named
 * market — not by pre-running the matcher to force a determination.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

config({ path: resolve(process.cwd(), '.env.local') });

import { getCurrentAcquisitionIntelligence } from '@/lib/opportunities/current-acquisition-intelligence';
import { matchCompanyToPathways } from '@/lib/pathways';
import { matchCompanyToPathwaysPure, stripEvidenceSide } from '@/lib/pathways/pathway-fit-match';
import { resolvePathwayFitIdentity, loadCompanyPublicRecord } from '@/lib/pathways/pathway-fit-load';
import type { MatchCompanyToPathwaysResult } from '@/lib/pathways/pathway-fit-types';

type ProbeSpec = {
  id: 'A' | 'B' | 'C';
  label: string;
  cai: { agency: string; capability: string };
  company_name: string;
};

const SPECS: ProbeSpec[] = [
  {
    id: 'A',
    label: 'SOCOM + cybersecurity + federal IT/cyber company',
    cai: { agency: 'SOCOM', capability: 'cybersecurity' },
    company_name: 'Booz Allen Hamilton',
  },
  {
    id: 'B',
    label: 'VA + IT + federal IT company',
    cai: { agency: 'Department of Veterans Affairs', capability: 'information technology' },
    company_name: 'Leidos',
  },
  {
    id: 'C',
    label: 'USACE + construction + federal construction company',
    cai: { agency: 'USACE', capability: 'construction' },
    company_name: 'Hensel Phelps',
  },
];

function compact(r: MatchCompanyToPathwaysResult) {
  const positive = r.doors.filter(
    (d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT',
  );
  return {
    company: r.company,
    identity_resolution: r._meta.identity_resolution,
    identity_note: r._meta.identity_note,
    identity_candidates: r._meta.identity_candidates,
    buyer_context: r.buyer_context,
    headline: r.summary.headline,
    no_proven_door: r.summary.no_proven_door,
    supported: r.summary.supported_count,
    possible: r.summary.possible_count,
    not_established: r.summary.not_established_count,
    not_applicable: r.summary.not_applicable_count,
    ranked: r.doors.map((d) => ({
      door: d.door,
      door_label: d.door_label,
      determination: d.determination,
      score: d.rank.score,
      components: d.rank.components,
      why_this_fit: d.why_this_fit,
      buyer_evidence: d.buyer_evidence.map((e) => ({
        role: e.role,
        source_kind: e.source_kind,
        statement: e.statement,
      })),
      company_evidence: d.company_evidence.map((e) => ({
        role: e.role,
        source_kind: e.source_kind,
        statement: e.statement,
      })),
      proof_to_lead_with: d.proof_to_lead_with.map((p) => ({
        kind: p.kind,
        label: p.label,
        why_related: p.why_related,
      })),
      proof_missing: d.proof_missing.map((m) => ({ code: m.code, statement: m.statement })),
      additional_advantages: d.additional_advantages.map((a) => a.statement),
      safe_next_actions: d.safe_next_actions,
    })),
    positive: positive.map((d) => ({ door: d.door, determination: d.determination, score: d.rank.score })),
    owner_asserted_context: r.owner_asserted_context ?? null,
    _next: r._next,
    _meta: {
      grounded: r._meta.grounded,
      degraded: r._meta.degraded,
      sources_queried: r._meta.sources_queried,
      sources_failed: r._meta.sources_failed,
      epistemic_note: r._meta.epistemic_note,
    },
  };
}

async function runProbe(spec: ProbeSpec) {
  const identity = await resolvePathwayFitIdentity({ company_name: spec.company_name });
  const cai = await getCurrentAcquisitionIntelligence({
    agency: spec.cai.agency,
    capability: spec.cai.capability,
    window_days: 90,
  });
  const result = await matchCompanyToPathways({
    uei: identity.uei || undefined,
    company_name: spec.company_name,
    cai,
    actor: 'pathway-fit-live-probe',
  });
  return {
    spec,
    identity,
    cai_observed: cai.pathways.observed.map((o) => ({
      kind: o.kind,
      statement: o.statement,
      evidence_count: o.evidence_count,
    })),
    cai_potential: cai.pathways.potential_not_established.map((p) => p.kind),
    cai_sources_failed: cai._meta.sources_failed,
    cai_grounded: cai._meta.grounded,
    cai_degraded: cai._meta.degraded,
    do_differently_count: cai.do_differently.length,
    match: compact(result),
    raw: result,
  };
}

async function twoSided(live: Awaited<ReturnType<typeof runProbe>>) {
  const loaded = await loadCompanyPublicRecord({
    uei: live.identity.uei || undefined,
    company_name: live.spec.company_name,
    actor: 'pathway-fit-live-probe',
  });
  const cai = live.raw as unknown as Parameters<typeof matchCompanyToPathwaysPure>[0];
  // Re-coerce from original CAI via the match already stored: use live.raw buyer/company
  // by re-running pure matcher on the same loaded company + slim extracted from result.
  const slim = {
    scope: {
      agency: live.raw.buyer_context.agency,
      office: live.raw.buyer_context.office,
      capability: live.raw.buyer_context.capability,
    },
    pathways: {
      observed: live.cai_observed.map((o) => ({
        kind: o.kind,
        established: true as const,
        statement: o.statement,
        citations: [{ source_kind: 'live_cai', source_id: null, locator: o.kind, as_of: null }],
        evidence_count: o.evidence_count,
      })),
      potential_not_established: live.cai_potential.map((kind) => ({ kind })),
    },
    as_of: live.raw.buyer_context.cai_as_of,
  };
  const baseline = matchCompanyToPathwaysPure(slim, loaded.company);
  const noBuyer = stripEvidenceSide(baseline, 'buyer');
  const noCompany = stripEvidenceSide(baseline, 'company');
  const pos = (r: MatchCompanyToPathwaysResult) =>
    r.doors.filter((d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT').map((d) => d.door);
  return {
    baseline_positive: pos(baseline),
    after_remove_buyer: pos(noBuyer),
    after_remove_company: pos(noCompany),
    buyer_strip_clears: pos(noBuyer).length === 0,
    company_strip_clears: pos(noCompany).length === 0,
  };
}

async function main() {
  const out: Array<Omit<Awaited<ReturnType<typeof runProbe>>, 'raw'> & { raw?: undefined }> = [];
  for (const spec of SPECS) {
    console.error(`\n--- ${spec.id}: ${spec.label} ---`);
    const probe = await runProbe(spec);
    console.error(
      JSON.stringify(
        {
          identity: probe.identity,
          cai_observed: probe.cai_observed,
          cai_potential: probe.cai_potential,
          cai_failed: probe.cai_sources_failed,
          match_summary: {
            uei: probe.match.company.uei,
            name: probe.match.company.legal_name,
            no_proven_door: probe.match.no_proven_door,
            positive: probe.match.positive,
            _next: probe.match._next,
          },
        },
        null,
        2,
      ),
    );
    out.push({
      ...probe,
      raw: undefined,
      match: probe.match,
    });
  }

  const withPositive = out.find((p) => p.match.positive.length > 0);
  let two_sided = null;
  if (withPositive) {
    const live = await runProbe(withPositive.spec);
    two_sided = await twoSided(live);
    console.error('\n--- two-sided live deletion ---');
    console.error(JSON.stringify(two_sided, null, 2));
  }

  const payload = { as_of: new Date().toISOString(), probes: out, two_sided };
  writeFileSync('/tmp/pathway-fit-live-probes.json', JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
