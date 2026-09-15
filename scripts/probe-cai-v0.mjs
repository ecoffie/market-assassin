/**
 * Host acceptance probes for Current Acquisition Intelligence v0.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/probe-cai-v0.mjs
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

const { getCurrentAcquisitionIntelligence } = await import(
  '../src/lib/opportunities/current-acquisition-intelligence.ts'
);

const PROBES = [
  {
    label: 'A — USSOCOM + cybersecurity',
    input: { agency: 'USSOCOM', capability: 'cybersecurity', naics: ['541512'], window_days: 90 },
  },
  {
    label: 'B — VA + information technology',
    input: { agency: 'Veterans Affairs', capability: 'information technology', window_days: 90 },
  },
  {
    label: 'C — USACE + construction',
    input: { agency: 'Corps of Engineers', capability: 'construction', naics: ['236220'], window_days: 90 },
  },
];

function compact(result) {
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
    do_differently_graph: result.do_differently.map((d) => ({
      id: d.id,
      caused_by: d.caused_by,
    })),
    pathways_observed: result.pathways.observed.map((p) => p.kind),
    pathways_potential: result.pathways.potential_not_established.map((p) => p.kind),
    _next: result._next,
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
