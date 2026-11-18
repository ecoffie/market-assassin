#!/usr/bin/env npx tsx
/**
 * Read-only / hermetic bench for Ask Mindy R2 hygiene.
 * Replays the eight measured cases (+ T7 docs outlier) through decideSecondToolRound
 * and dropDuplicateRound2Calls. Before numbers come from ASK-MINDY-R2-EVALUATION-2026-11-18
 * (A4 live measurements). After numbers are projected from the new gate + dedupe
 * (skipped R2 → single planner pass cost).
 *
 * No network. No deploy.
 */
import {
  decideSecondToolRound,
  dropDuplicateRound2Calls,
} from '../src/lib/chat/second-tool-round';

type Before = {
  offered: boolean;
  class: 'clean_hop' | 'pure_dup' | 'no_calls' | 'ambiguous' | 'docs_outlier';
  wall_s: number | null;
  planner_prompt_tok: number;
  planner_usd_terra: number;
  r2_tools: string[];
};

const BEFORE_BASELINE = {
  // Single-round terra baseline from A4 (~T1–T3)
  single_pass_prompt_tok: 22_000,
  single_pass_usd: 0.022,
} as const;

const CASES: Array<{
  id: string;
  text: string;
  r1: Array<{ tool: string; status: string; args?: string }>;
  /** What R2 actually planned before hygiene (for dedupe projection). */
  r2_planned?: Array<{ id: string; function: { name: string; arguments: string } }>;
  before: Before;
}> = [
  {
    id: 'T4',
    text: 'Who held the previous contract for solicitation A031392 and which other companies compete with that incumbent',
    r1: [{ tool: 'get_solicitation_incumbent', status: 'success', args: '{"solicitation":"A031392"}' }],
    r2_planned: [{ id: 'c2', function: { name: 'find_capable_contractors', arguments: '{"naics":"541512"}' } }],
    before: { offered: true, class: 'clean_hop', wall_s: 21.0, planner_prompt_tok: 44_982, planner_usd_terra: 0.0453, r2_tools: ['find_capable_contractors'] },
  },
  {
    id: 'T6',
    text: 'Largest contracts awarded in FL for NAICS 541512 last year',
    r1: [{ tool: 'search_past_contracts', status: 'success', args: '{"state":"FL","naics":"541512"}' }],
    r2_planned: [],
    before: { offered: true, class: 'no_calls', wall_s: 11.0, planner_prompt_tok: 44_902, planner_usd_terra: 0.0455, r2_tools: [] },
  },
  {
    id: 'T7',
    text: 'What is solicitation 36C24626B0031 about and when is it due',
    r1: [{ tool: 'lookup_solicitation', status: 'success', args: '{"solicitation":"36C24626B0031"}' }],
    r2_planned: [{ id: 'd1', function: { name: 'get_solicitation_documents', arguments: '{"solicitation":"36C24626B0031"}' } }],
    before: { offered: true, class: 'docs_outlier', wall_s: 63.1, planner_prompt_tok: 50_901, planner_usd_terra: 0.0512, r2_tools: ['get_solicitation_documents'] },
  },
  {
    id: 'T8',
    text: 'What is solicitation 140A1627Q0105 about and when is it due',
    r1: [{ tool: 'lookup_solicitation', status: 'success', args: '{"solicitation":"140A1627Q0105"}' }],
    r2_planned: [{ id: 'd1', function: { name: 'lookup_solicitation', arguments: '{"solicitation":"140A1627Q0105"}' } }],
    before: { offered: true, class: 'pure_dup', wall_s: 14.0, planner_prompt_tok: 49_898, planner_usd_terra: 0.0502, r2_tools: ['lookup_solicitation'] },
  },
  {
    id: 'T9',
    text: 'What is solicitation FA480027Q0009 about and who is the contact',
    r1: [{ tool: 'lookup_solicitation', status: 'success', args: '{"solicitation":"FA480027Q0009"}' }],
    r2_planned: [{ id: 'c2', function: { name: 'search_federal_contacts', arguments: '{"agency":"Air Force"}' } }],
    before: { offered: true, class: 'clean_hop', wall_s: 18.0, planner_prompt_tok: 45_017, planner_usd_terra: 0.0453, r2_tools: ['search_federal_contacts'] },
  },
  {
    id: 'B',
    text: 'Lookup W912WJ26QA168, past contracts, and contacts',
    r1: [
      { tool: 'lookup_solicitation', status: 'success', args: '{"solicitation":"W912WJ26QA168"}' },
      { tool: 'search_past_contracts', status: 'success', args: '{}' },
      { tool: 'search_federal_contacts', status: 'success', args: '{}' },
    ],
    r2_planned: [
      { id: 'd1', function: { name: 'lookup_solicitation', arguments: '{"solicitation":"W912WJ26QA168"}' } },
      { id: 'd2', function: { name: 'search_past_contracts', arguments: '{}' } },
      { id: 'd3', function: { name: 'search_federal_contacts', arguments: '{}' } },
    ],
    before: { offered: true, class: 'pure_dup', wall_s: 19.1, planner_prompt_tok: 44_089, planner_usd_terra: 0.045, r2_tools: ['lookup_solicitation', 'search_past_contracts', 'search_federal_contacts'] },
  },
  {
    id: 'C',
    text: 'Past contracts for snow removal in MA, then the buying-office contact',
    r1: [{ tool: 'search_past_contracts', status: 'success', args: '{"keyword":"snow removal","state":"MA"}' }],
    r2_planned: [{ id: 'c2', function: { name: 'search_federal_contacts', arguments: '{"keyword":"snow"}' } }],
    before: { offered: true, class: 'clean_hop', wall_s: 8.8, planner_prompt_tok: 42_051, planner_usd_terra: 0.042, r2_tools: ['search_federal_contacts'] },
  },
  {
    id: 'H',
    text: 'Past contracts for snow removal in MA, then the buying-office contact',
    r1: [{ tool: 'search_past_contracts', status: 'success', args: '{"keyword":"snow removal","state":"MA"}' }],
    r2_planned: [{ id: 'd1', function: { name: 'search_past_contracts', arguments: '{"keyword":"snow removal","state":"MA"}' } }],
    before: { offered: true, class: 'pure_dup', wall_s: 6.6, planner_prompt_tok: 42_096, planner_usd_terra: 0.042, r2_tools: ['search_past_contracts'] },
  },
  {
    id: 'D',
    text: 'Lookup bogus solicitation ZZZ999NOTREAL0001',
    r1: [{ tool: 'get_solicitation_incumbent', status: 'success', args: '{"solicitation":"ZZZ999NOTREAL0001"}' }],
    r2_planned: [{ id: 'd1', function: { name: 'lookup_solicitation', arguments: '{"solicitation":"ZZZ999NOTREAL0001"}' } }],
    before: { offered: true, class: 'ambiguous', wall_s: 10.8, planner_prompt_tok: 41_636, planner_usd_terra: 0.042, r2_tools: ['lookup_solicitation'] },
  },
  {
    id: 'DOC',
    text: 'Pull the SOW and attachments for solicitation FA480027Q0009',
    r1: [{ tool: 'lookup_solicitation', status: 'success', args: '{"solicitation":"FA480027Q0009"}' }],
    r2_planned: [{ id: 'c2', function: { name: 'get_solicitation_documents', arguments: '{"solicitation":"FA480027Q0009"}' } }],
    // Before hygiene there was no document cue; after, this is a preserved hop.
    before: { offered: false, class: 'clean_hop', wall_s: null, planner_prompt_tok: 22_000, planner_usd_terra: 0.022, r2_tools: [] },
  },
];

function afterProjection(c: (typeof CASES)[number]) {
  const decision = decideSecondToolRound(
    c.r1.map((r) => ({ tool: r.tool, status: r.status })),
    { customerText: c.text },
  );
  if (!decision.offer) {
    return {
      offer: false as const,
      reason: decision.reason,
      evidence: 'none_r2_skipped' as const,
      planner_prompt_tok: BEFORE_BASELINE.single_pass_prompt_tok,
      planner_usd_terra: BEFORE_BASELINE.single_pass_usd,
      wall_s_est: c.before.wall_s != null ? Math.min(c.before.wall_s, 14) : null,
      // T7 special: without documents hop, expect ~T8 single-lookup wall (~14s), not 63s
      note: c.id === 'T7' ? 'docs hop never starts; expect ~14s like plain lookup' : undefined,
    };
  }
  const cross = dropDuplicateRound2Calls(c.r2_planned || [], c.r1.map((r) => ({ tool: r.tool, args: r.args })));
  if (cross.keep.length === 0) {
    return {
      offer: true as const,
      reason: 'offered_but_deduped_empty',
      evidence: 'no_new_tool' as const,
      planner_prompt_tok: c.before.planner_prompt_tok, // still paid second planner
      planner_usd_terra: c.before.planner_usd_terra,
      wall_s_est: c.before.wall_s,
      deduped: cross.duplicates.map((d) => d.tool),
    };
  }
  return {
    offer: true as const,
    reason: 'offered',
    evidence: 'new_hop' as const,
    hop_tools: cross.keep.map((k) => k.function.name),
    planner_prompt_tok: c.before.planner_prompt_tok,
    planner_usd_terra: c.before.planner_usd_terra,
    wall_s_est: c.before.wall_s,
    deduped: cross.duplicates.map((d) => d.tool),
  };
}

const rows = CASES.map((c) => {
  const after = afterProjection(c);
  const saved_tok = c.before.planner_prompt_tok - after.planner_prompt_tok;
  const saved_usd = +(c.before.planner_usd_terra - after.planner_usd_terra).toFixed(4);
  return {
    id: c.id,
    before_class: c.before.class,
    before_offered: c.before.offered,
    before_wall_s: c.before.wall_s,
    before_prompt_tok: c.before.planner_prompt_tok,
    before_usd: c.before.planner_usd_terra,
    after,
    saved_tok,
    saved_usd,
  };
});

const offered_before = rows.filter((r) => r.before_offered).length;
const offered_after = rows.filter((r) => r.after.offer).length;
const clean_after = rows.filter((r) => r.after.evidence === 'new_hop').length;
const skipped = rows.filter((r) => !r.after.offer).length;
const tok_before = rows.reduce((s, r) => s + r.before_prompt_tok, 0);
const tok_after = rows.reduce((s, r) => s + r.after.planner_prompt_tok, 0);
const usd_before = rows.reduce((s, r) => s + r.before_usd, 0);
const usd_after = rows.reduce((s, r) => s + r.after.planner_usd_terra, 0);

console.log(JSON.stringify({
  summary: {
    cases: rows.length,
    offered_before,
    offered_after,
    clean_hops_preserved: clean_after,
    skipped_by_gate: skipped,
    planner_prompt_tok_before: tok_before,
    planner_prompt_tok_after: tok_after,
    planner_prompt_tok_saved: tok_before - tok_after,
    planner_usd_terra_before: +usd_before.toFixed(4),
    planner_usd_terra_after: +usd_after.toFixed(4),
    planner_usd_saved: +(usd_before - usd_after).toFixed(4),
    t7_docs_outlier: rows.find((r) => r.id === 'T7'),
  },
  rows,
}, null, 2));
