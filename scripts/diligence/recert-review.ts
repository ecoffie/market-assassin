/**
 * Run the recertification review over a target register.
 *
 *   npx tsx scripts/diligence/recert-review.ts --register .claude/diligence/halvik/register.json \
 *     --facts scripts/diligence/fixtures/halvik-deal-facts.json --as-of 2026-01-21 --out .claude/diligence/halvik/recert
 *
 * Read-only. Writes recert-review.json, recert-review.md and diligence-request-list.md to --out.
 * The workbook is not touched.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reviewRecertification, type DealFacts, type FactMode, type RecertReview } from '@/lib/diligence/recert/engine';

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const registerPath = arg('register');
const factsPath = arg('facts');
const asOf = arg('as-of');
const out = resolve(arg('out') ?? '.claude/diligence/out/recert');
const mode = (arg('mode') ?? 'knowable_at_as_of') as FactMode;
if (!registerPath || !factsPath || !asOf) throw new Error('--register, --facts and --as-of are required');

const reg = JSON.parse(readFileSync(registerPath, 'utf8')).register;
if (reg.as_of !== asOf) throw new Error(`register is frozen at ${reg.as_of}, not ${asOf}; rebuild it at the review as-of`);
const facts: DealFacts = JSON.parse(readFileSync(factsPath, 'utf8'));
const review = reviewRecertification({ rows: reg.rows, facts, asOf, mode });

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'recert-review.json'), JSON.stringify(review, null, 1));
writeFileSync(join(out, 'recert-review.md'), renderReview(review));
writeFileSync(join(out, 'diligence-request-list.md'), renderRequests(review));
console.error('[recert] wrote', out);

// ---------------------------------------------------------------------------
function usd(n: number | null | undefined) {
  return n === null || n === undefined ? 'unknown' : `$${Math.round(n).toLocaleString('en-US')}`;
}

function renderReview(r: RecertReview): string {
  const L: string[] = [];
  L.push(`# Recertification review — ${r.target_uei} as of ${r.as_of}`, '');
  L.push(`Policy \`${r.policy_version}\` · legal review status **${r.policy_legal_review_status}** · fact mode \`${r.fact_mode}\``, '', `> ${r.boundary}`, '');
  L.push('## Summary by rule', '', '_Rows overlap: one instrument can carry several rules. Do not sum across rows. Values are awards only (vehicle ceilings are program-wide)._', '');
  L.push('| Rule | Status | Instruments | Awards | Vehicles | Public obligated | Public ceiling | Ceiling not yet obligated |', '|---|---|---|---|---|---|---|---|');
  for (const s of r.summary) L.push(`| ${s.rule_id} ${s.title} | ${s.status} | ${s.instruments} | ${s.awards} | ${s.vehicles} | ${usd(s.public_obligated)} | ${usd(s.public_ceiling)} | ${usd(s.ceiling_not_yet_obligated)} |`);
  L.push('', '## Deal-level rules', '');
  for (const d of r.deal_rules) {
    L.push(`- **${d.rule_id} ${d.title}**: ${d.review.status}${d.review.depends_on.length ? ` · DEPENDS_ON ${d.review.depends_on.join(', ')}` : ''}`);
    for (const o of d.review.possible_outcomes) L.push(`  - if ${JSON.stringify(o.requires)} → ${o.status}: ${o.review_flag} (${o.citation})`);
  }
  L.push('', '## Instruments', '');
  for (const i of r.instruments) {
    const f = i.federal_fact;
    L.push(`### ${f.piid} (${f.kind}, ${f.class})`, '');
    L.push('**FEDERAL FACT**', '');
    L.push(`- instrument: ${f.instrument ?? 'not established'} · agency: ${f.awarding_agency ?? 'unknown'} · NAICS ${f.naics ?? 'unknown'}`);
    L.push(`- set-aside on award: ${f.set_aside_on_award ?? 'none reported'} · parent: ${f.parent_piid ?? 'none'}${f.parent_piid ? ` (${f.parent_in_register ? `set-aside ${f.parent_set_aside ?? 'none reported'}` : 'parent record not in register'})` : ''} · MAC NAICS: ${f.mac_naics ?? 'n/a'}`);
    L.push(`- CO size determination (latest by as-of): ${f.co_business_size ?? 'not reported'} · 8(a) basis: ${f.eight_a_basis ? 'yes' : 'no'} · programs: ${f.program_codes.join(', ') || 'none'} · over five years incl. options: ${f.long_term === null ? 'unknown' : f.long_term ? 'yes' : 'no'}`);
    if (f.values.attributable) L.push(`- obligated ${usd(f.values.obligated)} · ceiling ${usd(f.values.ceiling_base_and_all_options)} · ceiling not yet obligated ${usd(f.values.ceiling_not_yet_obligated)} · unexercised options ${usd(f.values.unexercised_options)}`);
    else L.push('- vehicle: ceiling is program-wide and not attributed');
    L.push(`- source: ${f.source_url}`, '');
    for (const rr of i.rules) {
      L.push(`**${rr.rule_id} ${rr.title}**`, '');
      L.push(`- REGULATORY FACT: ${rr.regulatory_fact.text} [${rr.regulatory_fact.citations.map((c) => c.cite).join('; ')}] (in force from ${rr.regulatory_fact.effective.from})`);
      const v = rr.review;
      if (v.status === 'NEEDS_REVIEW') {
        L.push(`- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON ${v.depends_on.join(', ') || '—'}${v.note ? ` · ${v.note}` : ''}`);
        for (const o of v.possible_outcomes) L.push(`  - possible: if ${JSON.stringify(o.requires)} → ${o.status}: ${o.review_flag} (${o.citation})`);
      } else {
        L.push(`- REVIEW FLAG: **${v.status}**${v.review_flag ? ` · ${v.review_flag}` : ''}${v.citation ? ` (${v.citation})` : ''}${v.note ? ` · ${v.note}` : ''}`);
      }
      if (v.facts_established.length) L.push(`- facts established: ${v.facts_established.map((e) => `${e.fact}=${e.value} [${e.source}]`).join('; ')}`);
      if (v.facts_missing.length) L.push(`- facts missing: ${v.facts_missing.join(', ')}`);
      L.push('');
    }
  }
  return L.join('\n');
}

function renderRequests(r: RecertReview): string {
  const L: string[] = [`# Diligence Request List — ${r.target_uei} as of ${r.as_of}`, '', `Generated from every NEEDS_REVIEW result (policy \`${r.policy_version}\`). Each item names the documents that would resolve it, and the rules and instruments it unblocks. Values are awards only and overlap across items.`, ''];
  r.diligence_requests.forEach((q, n) => {
    L.push(`## ${n + 1}. ${q.request}`, '', `- fact: \`${q.fact}\` · resolves rules ${q.rules.join(', ')}`);
    L.push(`- request: ${q.documents.join('; ')}`);
    if (q.scope_detail.length) L.push(`- scope: ${q.scope_detail.join(', ')}`);
    const awards = r.instruments.filter((i) => i.federal_fact.kind === 'award' && q.instruments.includes(i.federal_fact.piid)).length;
    const scope = q.instrument_count === 0
      ? ' (deal level)'
      : awards === 0
        ? ' (vehicles only — vehicle ceilings are program-wide, so no value is attributed)'
        : ` (${awards} awards: public obligated ${usd(q.public_obligated_attributable)}, public ceiling ${usd(q.public_ceiling_attributable)})`;
    L.push(`- instruments affected: ${q.instrument_count}${scope}`);
    if (q.instruments.length) L.push(`- PIIDs: ${q.instruments.join(', ')}`);
    L.push('');
  });
  return L.join('\n');
}
