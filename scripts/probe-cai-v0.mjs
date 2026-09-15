/**
 * Host acceptance probes for Current Acquisition Intelligence v0.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/probe-cai-v0.mjs
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Prefer a cleaned probe env when present (vercel pull often embeds literal \n).
const envPath = [
  resolve(__dirname, '../.env.local.probe'),
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../../../.env.local'),
].find((p) => {
  try {
    return require('fs').existsSync(p);
  } catch {
    return false;
  }
});
config({ path: envPath, quiet: true });
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[k]) {
    process.env[k] = String(process.env[k])
      .replace(/\\n/g, '')
      .replace(/\\r/g, '')
      .replace(/\r?\n/g, '')
      .trim();
  }
}

const { getCurrentAcquisitionIntelligence } = await import(
  '../src/lib/opportunities/current-acquisition-intelligence.ts'
);

const PROBES = [
  {
    label: 'A — USSOCOM + cybersecurity',
    input: { agency: 'SPECIAL OPERATIONS', capability: 'cybersecurity', naics: ['541512'], window_days: 90 },
  },
  {
    label: 'B — VA + information technology',
    input: { agency: 'Veterans Affairs', capability: 'information technology', window_days: 90 },
  },
  {
    label: 'C — Army construction (236220)',
    input: {
      agency: 'DEPT OF THE ARMY',
      capability: 'construction',
      naics: ['236220'],
      window_days: 90,
    },
  },
];

function compact(result) {
  const evidenceIds = new Set([
    ...result.what_changed.map((i) => i.id),
    ...result.what_we_are_seeing_now.map((i) => i.id),
  ]);
  const orphanActs = result.do_differently.filter(
    (d) => !d.caused_by?.length || !d.caused_by.every((id) => evidenceIds.has(id)),
  );
  const nextText = JSON.stringify(result._next).toLowerCase();
  return {
    grounded: result._meta.grounded,
    degraded: result._meta.degraded,
    section_counts: {
      what_changed: result.what_changed.length,
      what_we_are_seeing_now: result.what_we_are_seeing_now.length,
      what_that_may_mean: result.what_that_may_mean.length,
      do_differently: result.do_differently.length,
      not_yet_measurable: result.not_yet_measurable.length,
    },
    what_changed: result.what_changed.map((i) => ({
      id: i.id,
      statement: i.statement,
      citations: i.citations,
    })),
    what_we_are_seeing_now: result.what_we_are_seeing_now.map((i) => ({
      id: i.id,
      statement: i.statement,
      citations: i.citations,
    })),
    what_that_may_mean: result.what_that_may_mean.map((i) => ({
      id: i.id,
      statement: i.statement,
      caused_by: i.caused_by,
    })),
    do_differently_graph: result.do_differently.map((d) => ({
      id: d.id,
      statement: d.statement,
      caused_by: d.caused_by,
    })),
    orphan_do_differently: orphanActs.map((d) => d.id),
    pathways_observed: result.pathways.observed.map((p) => ({
      kind: p.kind,
      evidence_count: p.evidence_count,
      statement: p.statement,
    })),
    pathways_potential: result.pathways.potential_not_established.map((p) => p.kind),
    not_yet_measurable: result.not_yet_measurable.map((i) => i.statement),
    _next: result._next,
    acceptance: {
      no_orphan_do_differently: orphanActs.length === 0,
      no_set_aside_first_next: !/set-aside|8\(a\)|sdvosb|hubzone|wosb/.test(nextText),
      potential_gaps_named: ['consortium', 'rapid_acquisition_office', 'pae_portfolio'].every((k) =>
        result.pathways.potential_not_established.some((p) => p.kind === k),
      ),
      no_cheapest_bid_claim: !/cheapest bid/i.test(JSON.stringify(result)),
    },
    sources_failed: result._meta.sources_failed,
  };
}

let failed = false;
for (const probe of PROBES) {
  console.log('\n===', probe.label, '===');
  try {
    const result = await getCurrentAcquisitionIntelligence(probe.input);
    console.log(JSON.stringify(compact(result), null, 2));
  } catch (e) {
    failed = true;
    console.error('PROBE FAILED:', e.message || e);
  }
}

if (failed) process.exit(1);
