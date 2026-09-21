/**
 * RFP FORMAT + FAILURE-MODE ANALYZER (Task #9).
 *
 * Empirically validates the RFP-STRUCTURE-BASELINE against HUNDREDS of real RFPs
 * in our DB — so the "normal RFP" template (#10) and the pre-submission scanner
 * (#11) are grounded in what real solicitations actually look like, not theory.
 *
 * Two outputs, both deterministic (regex signal detection over the real notice
 * body — no LLM, fast, reproducible):
 *
 *   (A) STRUCTURE map  — FAR-15 UCF (explicit Section L/M) vs FAR-12 commercial
 *       combined-synopsis (quote-style) vs simplified; volume schemes; how often
 *       notices actually carry "Section L"/"Section M" labels.
 *
 *   (B) FAILURE-MODE rulebook — the recurring STRICT GATES that DQ a proposal,
 *       ranked by how often they appear across the corpus: page limits, separate
 *       price volume, amendment acknowledgment, required plans (QCP/safety/APP),
 *       reps & certs, submission deadline/portal, FAR 52.212-1 instructions, etc.
 *       This is what the scanner (#11) checks a draft against.
 *
 * Run:  npx tsx scripts/analyze-rfp-formats.ts            (default N=300)
 *       N=500 npx tsx scripts/analyze-rfp-formats.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const N = parseInt(process.env.N || '300', 10);

// --- Signal detectors: each returns true if the body shows the signal. ---
// Grouped: STRUCTURE (what kind of solicitation) + GATES (the strict DQ rules).

const STRUCTURE_SIGNALS: Record<string, RegExp> = {
  has_section_L: /\bsection\s+L\b|instructions?,?\s+conditions?,?\s+and\s+notices/i,
  has_section_M: /\bsection\s+M\b|evaluation\s+factors?\s+for\s+award/i,
  has_section_C_sow: /\bsection\s+C\b|statement\s+of\s+work\b|\bSOW\b|performance\s+work\s+statement|\bPWS\b/i,
  far_15_negotiated: /far\s*15|negotiated\s+procurement|52\.215|best\s+value\s+trade[- ]?off/i,
  far_12_commercial: /far\s*12|commercial\s+(item|product|service)|52\.212|\bSF\s?1449\b/i,
  far_13_simplified: /far\s*13|simplified\s+acquisition|\bSF\s?18\b/i,
  uses_volumes: /\bvolume\s+(i{1,3}|iv|v|one|two|three|1|2|3)\b|\btechnical\s+volume\b|\bprice\s+volume\b/i,
  is_idiq_macc: /\bIDIQ\b|indefinite[- ]delivery|\bMACC\b|\bMATOC\b|\bSATOC\b|multiple\s+award|task\s+order/i,
  rfq_quote: /request\s+for\s+quot|\bRFQ\b|submit\s+(a\s+)?quote|quotation/i,
  rfp_proposal: /request\s+for\s+propos|\bRFP\b|submit\s+(a\s+)?proposal|offeror\s+shall/i,
};

const GATE_SIGNALS: Record<string, { re: RegExp; label: string }> = {
  page_limit:        { re: /page\s+limit|not\s+to\s+exceed\s+\d+\s+pages?|maximum\s+of\s+\d+\s+pages?|\d+[- ]page\s+(limit|maximum)/i, label: 'Page limit imposed' },
  separate_price:    { re: /separate\s+(price|cost)\s+volume|price\s+(shall|must)\s+(be\s+)?(submitted\s+)?separate|do\s+not\s+include\s+price\s+in\s+the\s+technical/i, label: 'Price must be a separate volume' },
  amendment_ack:     { re: /acknowledge\s+(receipt\s+of\s+)?(all\s+)?amendments?|amendment\s+acknowledg|SF\s?30/i, label: 'Amendment acknowledgment required' },
  reps_certs:        { re: /representations?\s+and\s+certifications?|reps\s+and\s+certs|52\.204-8|52\.212-3|\bSAM\.gov\b\s+(registration|active)/i, label: 'Reps & certs / SAM registration' },
  required_qcp:      { re: /quality\s+control\s+plan|\bQCP\b|quality\s+assurance\s+(surveillance\s+)?plan/i, label: 'Quality Control Plan required' },
  required_safety:   { re: /safety\s+plan|accident\s+prevention\s+plan|\bAPP\b|EM\s?385|site\s+safety/i, label: 'Safety / APP required' },
  deadline:          { re: /due\s+(date|by)|response\s+date|no\s+later\s+than|closing\s+date|offers?\s+due|submission\s+deadline/i, label: 'Explicit submission deadline' },
  submission_method: { re: /submit\s+(via|to|through)|email\s+(to|your)|via\s+(the\s+)?(portal|sam\.gov|piee|email)|electronic\s+submission/i, label: 'Specific submission method/portal' },
  far_52_212_1:      { re: /52\.212-1|instructions\s+to\s+offerors\s*[—-]?\s*commercial/i, label: 'FAR 52.212-1 (commercial instructions)' },
  past_perf_req:     { re: /past\s+performance\b|\bCPARS\b|relevant\s+(recent\s+)?(experience|projects?)|references?\s+(shall|must|are\s+required)/i, label: 'Past performance required' },
  set_aside:         { re: /set[- ]aside|8\(a\)|SDVOSB|HUBZone|WOSB|EDWOSB|small\s+business\s+set/i, label: 'Set-aside eligibility gate' },
  bonding:           { re: /bond(ing|ed)?\b|performance\s+bond|payment\s+bond|surety/i, label: 'Bonding required' },
};

interface Analyzed { source: string; len: number; structure: Record<string, boolean>; gates: Record<string, boolean>; }

function analyze(body: string, source: string): Analyzed {
  const structure: Record<string, boolean> = {};
  for (const [k, re] of Object.entries(STRUCTURE_SIGNALS)) structure[k] = re.test(body);
  const gates: Record<string, boolean> = {};
  for (const [k, g] of Object.entries(GATE_SIGNALS)) gates[k] = g.re.test(body);
  return { source, len: body.length, structure, gates };
}

async function main() {
  console.log(`Sampling up to ${N} real RFPs…\n`);
  const rows: Analyzed[] = [];

  // (1) sam_opportunities — real Solicitations + Combined Synopsis with body text.
  const { data: sam } = await sb.from('sam_opportunities')
    .select('notice_type, sow_text, description')
    .in('notice_type', ['Solicitation', 'Combined Synopsis/Solicitation'])
    .not('sow_text', 'is', null)
    .limit(N);
  for (const r of sam || []) {
    const body = (r.sow_text || r.description || '') as string;
    if (body.length >= 300) rows.push(analyze(body, r.notice_type));
  }

  // (2) pursuit_documents — real uploaded RFPs (the heavier full solicitations).
  const { data: pd } = await sb.from('pursuit_documents')
    .select('doc_kind, extracted_text')
    .in('doc_kind', ['solicitation', 'instructions', 'eval_factors', 'sow_pws'])
    .not('extracted_text', 'is', null)
    .limit(150);
  for (const r of pd || []) {
    const body = (r.extracted_text || '') as string;
    if (body.length >= 300) rows.push(analyze(body, `uploaded:${r.doc_kind}`));
  }

  const total = rows.length;
  const pct = (n: number) => `${n} (${total ? Math.round((n / total) * 100) : 0}%)`;
  const countTrue = (pick: (a: Analyzed) => boolean) => rows.filter(pick).length;

  // --- (A) STRUCTURE ---
  const structLines: string[] = ['## (A) Structure signals\n', `Sampled **${total}** real RFP bodies (sam_opportunities + uploaded pursuit docs).\n`];
  const structAgg = Object.keys(STRUCTURE_SIGNALS)
    .map((k) => ({ k, n: countTrue((a) => a.structure[k]) }))
    .sort((a, b) => b.n - a.n);
  for (const { k, n } of structAgg) structLines.push(`- \`${k}\`: ${pct(n)}`);

  // Headline classification: explicit L/M (UCF FAR-15) vs commercial.
  const ucf = countTrue((a) => a.structure.has_section_L && a.structure.has_section_M);
  const commercial = countTrue((a) => a.structure.far_12_commercial || a.structure.far_52_212_1 || a.structure.rfq_quote);
  const volumes = countTrue((a) => a.structure.uses_volumes);
  structLines.push(`\n**Headline:** explicit Section L **and** M (full UCF): ${pct(ucf)} · commercial/FAR-12/RFQ signals: ${pct(commercial)} · uses a volume scheme: ${pct(volumes)}`);

  // --- (B) FAILURE-MODE GATES ---
  const gateLines: string[] = ['\n## (B) Failure-mode gates (ranked by frequency)\n', 'The strict requirements that DQ a proposal when missed. The scanner (#11) checks a draft against these.\n'];
  const gateAgg = Object.keys(GATE_SIGNALS)
    .map((k) => ({ k, label: GATE_SIGNALS[k].label, n: countTrue((a) => a.gates[k]) }))
    .sort((a, b) => b.n - a.n);
  for (const { label, n } of gateAgg) gateLines.push(`- **${label}**: appears in ${pct(n)} of RFPs`);

  const md = [
    '# RFP Format + Failure-Mode Analysis (empirical)\n',
    `_Generated from ${total} real RFP bodies. Validates docs/RFP-STRUCTURE-BASELINE.md._\n`,
    ...structLines, ...gateLines,
    '\n## Machine-readable summary\n', '```json',
    JSON.stringify({
      total,
      structure: Object.fromEntries(structAgg.map((s) => [s.k, s.n])),
      gates: Object.fromEntries(gateAgg.map((g) => [g.k, g.n])),
      classification: { ucf_full_LM: ucf, commercial_or_rfq: commercial, uses_volumes: volumes },
    }, null, 2),
    '```',
  ].join('\n');

  const out = join(__dirname, '..', 'docs', 'RFP-FORMAT-ANALYSIS.md');
  writeFileSync(out, md);
  console.log(md);
  console.log(`\nWrote → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
