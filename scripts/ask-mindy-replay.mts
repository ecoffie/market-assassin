/**
 * Ask Mindy evidence replay (Verified Intelligence Engine, Phase D). No model calls, no network.
 *
 * Re-renders saved tool evidence from benchmark runs through the deterministic renderers and checks:
 *   1. determinism: rendering the same evidence twice gives byte-identical text;
 *   2. identical evidence across runs (same tool + same result JSON) gives identical text;
 *   3. planner variance: how many distinct tool-argument sets the model produced per question across
 *      runs (separates planner variability from data variability).
 *
 * Usage: npx tsx scripts/ask-mindy-replay.mts <runDir> [<runDir> ...]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  renderExpiringRecords, renderStatusChecks, renderBuyingOffices, renderPricing, renderKeywords, renderVehicleMix,
} from '../src/lib/chat/record-render';
import { interpretCapabilityNaics } from '../src/lib/market/capability-naics';

type Rec = Record<string, unknown>;
const RENDER: Record<string, (r: Rec, prompt: string) => { text: string } | null> = {
  get_expiring_contracts: (r, p) => renderExpiringRecords(r, { requestedLabels: interpretCapabilityNaics(p).items.map((i) => i.label) }),
  search_past_contracts: (r) => renderStatusChecks(r),
  get_buying_offices: (r) => renderBuyingOffices(r),
  get_pricing_intel: (r) => renderPricing(r),
  derive_company_keywords: (r) => renderKeywords(r),
  get_vehicle_spend_mix: (r) => renderVehicleMix(r),
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const runs = process.argv.slice(2).filter((d) => existsSync(d));
if (!runs.length) { console.error('usage: ask-mindy-replay.mts <runDir>...'); process.exit(2); }

let nondeterministic = 0;
const byEvidence = new Map<string, Set<string>>();
const argsByQuestion = new Map<string, Set<string>>();
for (const dir of runs) {
  for (const f of readdirSync(dir).filter((x) => /^R\d+\.json$/.test(x))) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { scenario: { id: string; prompt: string }; evidence: Array<{ tool: string; args: unknown; result_excerpt?: string }> };
    const q = d.scenario.id;
    const argSet = argsByQuestion.get(q) ?? new Set<string>();
    argSet.add(JSON.stringify(d.evidence.map((e) => [e.tool, e.args])));
    argsByQuestion.set(q, argSet);
    for (const e of d.evidence) {
      const render = RENDER[e.tool];
      if (!render || !e.result_excerpt) continue;
      let result: Rec;
      try { result = JSON.parse(e.result_excerpt); } catch { continue; }
      const a = render(result, d.scenario.prompt)?.text ?? '';
      const b = render(JSON.parse(e.result_excerpt), d.scenario.prompt)?.text ?? '';
      if (a !== b) { nondeterministic++; console.log(`NONDETERMINISTIC ${dir} ${q} ${e.tool}`); }
      const key = `${q}|${e.tool}|${hash(e.result_excerpt)}`;
      const set = byEvidence.get(key) ?? new Set<string>();
      set.add(hash(a));
      byEvidence.set(key, set);
    }
  }
}
const conflicting = [...byEvidence.entries()].filter(([, v]) => v.size > 1);
console.log(`runs: ${runs.length} · evidence items: ${byEvidence.size} · nondeterministic renders: ${nondeterministic} · identical evidence with different text: ${conflicting.length}`);
for (const [k] of conflicting) console.log(`  DIFFERENT TEXT FOR SAME EVIDENCE: ${k}`);
console.log('planner variance (distinct tool-argument sets per question across runs):');
for (const [q, s] of [...argsByQuestion.entries()].sort((x, y) => Number(x[0].slice(1)) - Number(y[0].slice(1)))) console.log(`  ${q}: ${s.size}`);
process.exit(nondeterministic || conflicting.length ? 1 : 0);
