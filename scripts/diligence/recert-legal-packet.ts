/**
 * Generate the human-readable LEGAL REVIEW PACKET for the recertification policy.
 * Generated from policy.ts + a real review run, so the packet cannot drift from the code.
 *
 *   npx tsx scripts/diligence/recert-legal-packet.ts \
 *     --fixture src/lib/diligence/recert/__fixtures__/halvik-register-2026-01-21.json \
 *     --facts scripts/diligence/fixtures/halvik-deal-facts.json --as-of 2026-01-21 \
 *     --out docs/legal/recert-policy-legal-review-packet.md
 *
 * Do not hand-edit the output. Change policy.ts and regenerate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { reviewRecertification, type RecertReview, type RuleReview } from '@/lib/diligence/recert/engine';
import { POLICY_LEGAL_REVIEW_STATUS, POLICY_VERSION, PROHIBITED_WORDING, RULES, type FactId, type InstrumentClass, type RuleDef } from '@/lib/diligence/recert/policy';

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const fixturePath = arg('fixture');
const factsPath = arg('facts');
const asOf = arg('as-of');
const out = arg('out');
if (!fixturePath || !factsPath || !asOf || !out) throw new Error('--fixture, --facts, --as-of and --out are required');
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));
const review = reviewRecertification({ rows: fx.rows, facts: JSON.parse(readFileSync(factsPath, 'utf8')), asOf });

const CLASS: Record<InstrumentClass, string> = {
  vehicle_set_aside_mac: 'Vehicle held: multiple-award contract set aside or reserved for small business',
  vehicle_unrestricted_mac: 'Vehicle held: unrestricted multiple-award contract (incl. GSA Schedule)',
  vehicle_set_aside_single: 'Vehicle held: single-award contract set aside for small business',
  vehicle_unrestricted_single: 'Vehicle held: unrestricted single-award contract',
  award_set_aside_standalone: 'Standalone contract set aside for small business',
  award_unrestricted_standalone: 'Standalone unrestricted contract',
  order_under_single_award_set_aside: 'Order under a single-award small business set-aside contract',
  order_under_single_award_unrestricted: 'Order under an unrestricted single-award contract',
  order_under_set_aside_mac: 'Order already awarded under a set-aside multiple-award contract',
  set_aside_order_under_unrestricted_mac: 'Set-aside order under an unrestricted multiple-award contract',
  unrestricted_order_under_unrestricted_mac: 'Unrestricted order under an unrestricted multiple-award contract',
  order_parent_not_established: 'Order whose parent vehicle record is not available (restricted vs unrestricted unknown)',
};
const FACT: Record<FactId, string> = {
  T1_change_of_controlling_interest: 'Did the transaction result in a change in controlling interest of the awardee (or an affiliate)?',
  T2_transaction_date: 'Date the merger, acquisition or sale occurred, relative to 2026-01-17',
  T3_acquirer_size_under_naics: 'Is the acquiring entity small under the NAICS code assigned to the MAC?',
  T4_recertification_outcome: 'Was the recertification for this award qualifying or disqualifying?',
  T5a_8a_ownership_or_control_relinquished: 'Did the individuals on whom 8(a) eligibility was based relinquish ownership or control?',
  T5b_8a_waiver_status: 'Status of any 124.515 waiver (granted / denied / pending / not requested)',
  F_partial_set_aside_portion: 'Which portion (reserved or unrestricted) of a partial set-aside MAC does the holder occupy?',
  F_g2_option_conditions: 'Are the 125.12(g)(2) conditions met (disqualifying recertification before end of year five; options exercised before 2026-01-17)?',
  F_pending_offers: 'Were offers pending at the triggering event?',
  I_options_on_existing_orders: 'INTERPRETATION — does 125.12(e)(2)(iii)(B) reach options on orders already awarded under a set-aside MAC?',
  I_g1_scope_unrestricted_mac: 'INTERPRETATION — does 125.12(g)(1) reach set-aside orders under an unrestricted MAC?',
};
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const factList = (fs: FactId[]) => (fs.length ? fs.map((f) => `\`${f}\` — ${FACT[f]}`).join('<br>') : '—');

function triggerFacts(rule: RuleDef): FactId[] {
  if (!rule.branches.length) return [];
  const sets = rule.branches.map((b) => new Set(Object.keys(b.when)));
  return (rule.required_facts.filter((f) => sets.every((s) => s.has(f))));
}

function exampleFor(rule: RuleDef, r: RecertReview): { piid: string | null; rr: RuleReview } | null {
  if (rule.applies_to === 'deal') {
    const d = r.deal_rules.find((x) => x.rule_id === rule.id);
    return d ? { piid: null, rr: d } : null;
  }
  const hits = r.instruments.map((i) => ({ i, rr: i.rules.find((x) => x.rule_id === rule.id) })).filter((x) => x.rr);
  const pick = hits.sort((a, b) => (b.i.federal_fact.values.obligated ?? -1) - (a.i.federal_fact.values.obligated ?? -1))[0];
  return pick ? { piid: pick.i.federal_fact.piid, rr: pick.rr! } : null;
}

function renderExample(rule: RuleDef, r: RecertReview): string[] {
  const ex = exampleFor(rule, r);
  if (!ex) return ['_No Halvik instrument reaches this rule at the as-of date._'];
  const L: string[] = [];
  if (ex.piid) {
    const f = r.instruments.find((i) => i.federal_fact.piid === ex.piid)!.federal_fact;
    L.push(`**Halvik example: \`${f.piid}\`** (${CLASS[f.class]})`, '');
    L.push(`- FEDERAL FACT: set-aside on award ${f.set_aside_on_award ?? 'none reported'}; parent ${f.parent_piid ?? 'none'}${f.parent_piid ? ` (set-aside ${f.parent_set_aside ?? 'none reported'})` : ''}; MAC NAICS ${f.mac_naics ?? 'n/a'}; CO size ${f.co_business_size ?? 'not reported'}; ${f.values.attributable ? `public obligated ${usd(f.values.obligated ?? 0)}, public ceiling ${usd(f.values.ceiling_base_and_all_options ?? 0)}` : 'vehicle (ceiling program-wide, not attributed)'}`);
  } else {
    L.push('**Halvik example: deal level**', '');
  }
  L.push(`- REGULATORY FACT: ${ex.rr.regulatory_fact.citations.map((c) => c.cite).join('; ')}`);
  const v = ex.rr.review;
  if (v.status === 'NEEDS_REVIEW') {
    L.push(`- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON ${v.depends_on.map((d) => `\`${d}\``).join(', ')}${v.note ? ` · ${v.note}` : ''}`);
    for (const o of v.possible_outcomes) L.push(`  - possible: ${Object.entries(o.requires).map(([k, x]) => `${k}=${x}`).join(', ') || '(always)'} → ${o.status}: "${o.review_flag}"`);
  } else {
    L.push(`- REVIEW FLAG: **${v.status}**${v.review_flag ? ` · "${v.review_flag}"` : ''}`);
  }
  return L;
}

const L: string[] = [];
L.push('# Recertification review policy: legal review packet', '');
L.push('> **DRAFT FOR COUNSEL. NOT LEGALLY REVIEWED.**');
L.push(`> Policy status: \`${POLICY_LEGAL_REVIEW_STATUS}\`. No rule in this packet has been reviewed or approved by qualified counsel.`);
L.push('> Each rule is an engineering transcription of primary text (eCFR / Federal Register / acquisition.gov, verified 2026-10-07).');
L.push('> The engine outputs review flags. It does not output legal determinations.', '');
L.push(`- Policy version: \`${POLICY_VERSION}\``);
L.push(`- Generated: ${new Date().toISOString()} from \`src/lib/diligence/recert/policy.ts\` and a review of the Halvik regression fixture (UEI ${review.target_uei}, as of ${review.as_of}, all deal facts unknown). **Do not hand-edit**: change the policy and regenerate.`);
L.push('- Code: PR #1861 (held for this review; not merged; no production use).', '');
L.push('**Primary sources:**');
L.push('- 13 CFR 125.12: eCFR versions 2025-01-16 and 2025-06-04; no later version through 2026-10-01.');
L.push('- 89 FR 102448 (Dec 17, 2024). DATES: "This rule is effective on January 16, 2025."');
L.push('- 90 FR 23609 (Jun 4, 2025), Correction. Redesignated 125.12(g)(i),(ii) as (g)(1),(2). No other change to 125.12.');
L.push('- 13 CFR 124.515: current text since the 2023-05-30 eCFR version.');
L.push('- 13 CFR 124.105(i); 121.404(c)(4), (i); 126.619; 127.504; 128.401.');
L.push('- FAR 52.219-28 (JAN 2025) and FAR 19.301-2 (FAC 2026-01). Supporting only.', '');

// ---- Part A: the two unresolved questions ----
L.push('## Part A — Questions for counsel (unresolved; the engine does not answer them)', '');
const qs: Array<{ id: FactId; rule: string; q: string; text: string; now: string }> = [
  {
    id: 'I_options_on_existing_orders', rule: 'R7',
    q: 'Does 13 CFR 125.12(e)(2)(iii)(B) make a concern ineligible to receive options on an ORDER already awarded under a multiple award contract that is set aside or reserved for small business, or does it reach only options on the multiple award contract itself?',
    text: '125.12(e)(2)(iii)(B): "For a multiple award contract that is set-aside or reserved for small business, a concern that submits a disqualifying recertification … following a merger, acquisition, or sale involving a business entity that does not itself qualify as small under the NAICS code assigned to the multiple award contract is ineligible to receive options." 125.12(a)(3): "Recertification does not change the terms and conditions of the award."',
    now: 'R7 has no branch. Every order under a set-aside MAC that has unexercised option value is reported NEEDS_REVIEW, DEPENDS_ON this question, with no outcome offered.',
  },
  {
    id: 'I_g1_scope_unrestricted_mac', rule: 'R8',
    q: 'For a transaction that occurred before January 17, 2026, does 13 CFR 125.12(g)(1) ("remains eligible for orders issued under an underlying small business multiple award contract") reach set-aside orders under an UNRESTRICTED multiple award contract (including GSA Schedule), or only orders under a small business MAC?',
    text: '125.12(g)(1): "A firm that has a disqualifying size or status recertification due to a merger, acquisition or sale that occurs prior to January 17, 2026 remains eligible for orders issued under an underlying small business multiple award contract. However, the agency cannot count any new or pending orders … towards its small business and socioeconomic goals. This includes set-asides, partial set-asides, and reserves …"',
    now: 'R8\'s pre-threshold, other-than-small branch is NEEDS_REVIEW and DEPENDS_ON this question. The branch can never resolve, because an interpretation can only be added by a new policy version.',
  },
];
qs.forEach((q, n) => {
  const req = review.diligence_requests.find((x) => x.fact === q.id);
  L.push(`### Q${n + 1}. ${q.q}`, '');
  L.push(`- **Governing text:** ${q.text}`);
  L.push(`- **What the engine does now:** ${q.now}`);
  if (req) L.push(`- **Halvik instruments that depend on it:** ${req.instrument_count} (public obligated ${usd(req.public_obligated_attributable)}, public ceiling ${usd(req.public_ceiling_attributable)}). PIIDs: ${req.instruments.join(', ')}`);
  L.push(`- **Requested answer:** a written position, with authority, that can be encoded as a new branch of ${q.rule} in a new policy version.`, '');
});

// ---- Part B: engineering choices counsel should confirm ----
L.push('## Part B — Engine choices for counsel to confirm or correct', '', 'These are not open interpretations in the engine. They are classification choices the engine makes from FPDS fields. Each one needs confirmation.', '');
[
  'Vehicles whose FPDS ordering-period end date is before the as-of date are treated as closed. They are excluded from the future-order and option rules (R5, R6). Existing orders under them stay in scope.',
  '"Restricted" vs "unrestricted" for a MAC is read from the FPDS set-aside field on the vehicle (IDV) record held by the target.',
  'Multiple-award BPAs, GWACs and GSA Schedules are treated as "multiple award contracts" for 125.12(e). The GSA Schedule treatment relies on 121.404(c)(4)(i) and (i).',
  'R1 applies to an award when the CO recorded SMALL BUSINESS on the latest action by the as-of date, or a set-aside code is on the award.',
  '124.515 (R13) is applied when an 8(a) set-aside code is on the award or its parent vehicle, whatever the holder\'s current 8(a) status. 124.105(i)(1) refers to a "Participant or former Participant that is performing one or more 8(a) contracts."',
  'The acquirer-size question (T3) is posed against the NAICS code on the MAC\'s own FPDS record.',
  'The 125.12(g)(2) protection for options is modeled as one fact covering two things: a disqualifying recertification before the end of year five of a long-term contract, and options exercised before 2026-01-17.',
  '"Long-term" means the period of performance including options exceeds five years, measured from the FPDS start date to the potential end date.',
  'FAR 52.219-28 and FAR 19.301-2 are supporting text only. The engine cites 125.12 for SBA eligibility and goaling, and notes the difference in goaling wording ("cannot count" vs "may no longer include").',
].forEach((t, n) => L.push(`${n + 1}. ${t}`));
L.push('');

// ---- Part C: the 15 rules ----
L.push('## Part C — The 15 rules', '');
for (const rule of RULES) {
  L.push(`### ${rule.id}. ${rule.title}`, '', `_Legal review status: ${POLICY_LEGAL_REVIEW_STATUS}_`, '');
  L.push('| Element | Content |', '|---|---|');
  L.push(`| Authority | ${rule.citations(asOf).map((c) => `[${c.cite}](${c.url})`).join('; ')} |`);
  L.push(`| Effective period | from ${rule.effective.from}${rule.effective.to ? ` to ${rule.effective.to}` : ' (no end)'}. Basis: ${rule.effective.basis} |`);
  L.push(`| Mechanic | ${rule.regulatory_fact} |`);
  L.push(`| Applicable instruments | ${rule.applies_to === 'deal' ? 'Deal level (not per instrument)' : rule.applies_to === 'all' ? 'All instrument types' : rule.applies_to.map((c) => CLASS[c]).join('; ')}${rule.applies_when ? `. Only when: ${rule.applies_when}` : ''} |`);
  L.push(`| Trigger facts | ${factList(triggerFacts(rule))} |`);
  L.push(`| Required facts | ${factList(rule.required_facts)} |`);
  L.push(`| Permitted wording | ${rule.permitted_wording.length ? rule.permitted_wording.map((w) => `"${w}"`).join('<br>') : '—'} |`);
  L.push(`| Prohibited wording | ${[...rule.prohibited_wording.map((w) => `"${w}"`), 'plus every global prohibition in Part D'].join('<br>')} |`);
  L.push('');
  if (rule.branches.length) {
    L.push('**Possible outcomes**', '', '| When | Status | Review flag (exact wording) | Citation |', '|---|---|---|---|');
    for (const b of rule.branches) L.push(`| ${Object.entries(b.when).map(([k, v]) => `${k} = ${v}`).join('<br>') || 'always'} | ${b.status} | ${b.review_flag} | ${b.citation} |`);
  } else {
    L.push(rule.required_facts.length
      ? '**Possible outcomes:** none. The governing text does not establish the treatment; the engine returns NEEDS_REVIEW.'
      : '**Possible outcomes:** informational only. No flag is produced.');
  }
  L.push('');
  const rows = review.summary.filter((s) => s.rule_id === rule.id);
  const deal = review.deal_rules.find((d) => d.rule_id === rule.id);
  L.push('**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)', '');
  if (deal) L.push(`- Deal level: ${deal.review.status}${deal.review.depends_on.length ? `, DEPENDS_ON ${deal.review.depends_on.join(', ')}` : ''}`);
  else if (!rows.length) L.push('- No Halvik instrument reaches this rule.');
  for (const s of rows) L.push(`- ${s.status}: ${s.instruments} instruments (${s.awards} awards, ${s.vehicles} vehicles); ${s.awards === 0 ? 'vehicles only: vehicle ceilings are program-wide, so no value is attributed' : `awards: public obligated ${usd(s.public_obligated)}, public ceiling ${usd(s.public_ceiling)}, ceiling not yet obligated ${usd(s.ceiling_not_yet_obligated)}`}`);
  L.push('', ...renderExample(rule, review), '');
}

// ---- Part D ----
L.push('## Part D — Global prohibited wording (enforced on every output)', '', '| Pattern | Why |', '|---|---|');
for (const p of PROHIBITED_WORDING) L.push(`| \`${p.pattern.source.replace(/\|/g, '\\|')}\` | ${p.why} |`);
L.push('', '---', `_Generated from code. Status ${POLICY_LEGAL_REVIEW_STATUS}. Ceiling (base + all options) is a contract ceiling; nothing in this packet is a forecast of work, an economic figure or a price effect._`);

writeFileSync(out, L.join('\n') + '\n');
console.error('[packet] wrote', out);
