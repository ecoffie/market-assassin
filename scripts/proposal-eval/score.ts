/**
 * Proposal-eval STEP 2: grade every drafted section. Two parts:
 *
 *  A) HARD FACT-CHECK (the gate). Pull every candidate FACT from the draft —
 *     numbers, $, %, contract/solicitation refs, ALL-CAPS org names, emails,
 *     phones — and check each against the KNOWN facts (vault) + the notice body.
 *     Anything not grounded is a fabrication. Any fabrication → section scores 0.
 *     This is ground_in_real_data turned into a test (Eric's live draft invented
 *     "15% savings / 95% satisfaction / John Doe").
 *
 *  B) LLM JUDGE (the quality score). Claude scores 0-100 against a rubric:
 *     answers the notice's asks, right structure, federal voice, no GPT-tells,
 *     no leftover [placeholders].
 *
 *  Section score = 0 if any fabrication else qualityScore.
 *
 * Output: scripts/proposal-eval/out/report.md (human worklist) + report.json.
 *
 * Run:  npx tsx scripts/proposal-eval/score.ts
 *
 * (Memory: proposal_offline_eval_harness)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callLLM } from '../../src/lib/llm/call-llm';
import { loadKnownFacts } from './lib';

// ---- A) Fact extraction + grounding check ---------------------------

// Normalize for substring matching: lowercase, strip non-alphanumerics so
// "$1,200,000" and "1200000" and "1.2M" can be compared loosely.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Pull candidate facts worth checking. We deliberately IGNORE the bidder's own
// known identity tokens (added to the haystack) so true facts pass.
function extractFacts(draft: string): string[] {
  const facts = new Set<string>();
  // Percentages and explicit metric claims: "15%", "95% satisfaction"
  for (const m of draft.matchAll(/\b\d{1,3}(?:\.\d+)?\s*%/g)) facts.add(m[0].trim());
  // Dollar amounts: "$1.2M", "$450,000"
  for (const m of draft.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|million|billion)?/gi)) facts.add(m[0].trim());
  // "N engagements/contracts/clients/projects/years" quantified claims
  for (const m of draft.matchAll(/\b\d{1,4}\s+(?:engagements?|contracts?|clients?|projects?|organizations?|agencies|awards?)\b/gi)) facts.add(m[0].trim());
  // Emails + phones (catch hallucinated POCs like john.doe@ / 555-123-4567)
  for (const m of draft.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) facts.add(m[0].trim());
  for (const m of draft.matchAll(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g)) facts.add(m[0].trim());
  // Solicitation/contract-number-ish tokens (mix of letters+digits, 6+)
  for (const m of draft.matchAll(/\b[A-Z0-9]{2,}-?[A-Z0-9]{2,}(?:-[A-Z0-9]+)+\b/g)) facts.add(m[0].trim());
  return [...facts];
}

interface Fabrication { fact: string; }

function checkGrounding(draft: string, haystack: string): Fabrication[] {
  const hay = norm(haystack);
  const out: Fabrication[] = [];
  for (const f of extractFacts(draft)) {
    const nf = norm(f);
    if (!nf) continue;
    // A fact is grounded if its normalized form appears in the haystack
    // (vault + notice body + the rest of the draft's own template tokens).
    if (!hay.includes(nf)) {
      // Loosen for $/M phrasing: try the bare digits too.
      const digits = f.replace(/[^0-9]/g, '');
      if (digits.length >= 3 && hay.includes(digits)) continue;
      out.push({ fact: f });
    }
  }
  return out;
}

// ---- B) LLM judge ---------------------------------------------------

const JUDGE_SYSTEM = `You are a strict federal proposal evaluator scoring ONE drafted response section. Score 0-100 on:
- Responsiveness: directly answers what the notice asks for (40)
- Structure & format: correct for the section type, no leftover [placeholders] (20)
- Federal voice: concrete, evidence-oriented, no fluff/GPT-tells ("in today's landscape", triple adjectives, "world-class") (20)
- Concision & relevance: on-target length, nothing padded (20)
Respond with JSON only: { "score": <0-100>, "issues": ["short issue", ...] }. Be harsh — 90+ means submission-ready.`;

async function judge(label: string, draft: string, noticeBody: string): Promise<{ score: number; issues: string[] }> {
  const user = `SECTION: ${label}\n\nNOTICE (excerpt):\n${noticeBody.slice(0, 4000)}\n\nDRAFT:\n${draft}\n\nScore it. JSON only.`;
  try {
    const { text } = await callLLM({ system: JUDGE_SYSTEM, user, json: true, maxTokens: 500, temperature: 0, job: 'referee' });
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5) : [] };
  } catch (e) {
    return { score: 0, issues: [`judge failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ---- Main -----------------------------------------------------------

async function main() {
  const { vaultEmail, results } = JSON.parse(
    readFileSync(join(__dirname, 'out', 'drafts.json'), 'utf8'),
  ) as { vaultEmail: string; results: Array<{ label: string; notice_type: string; body: string; sections: Array<{ section: string; label: string; draft: string }>; errors: unknown[] }> };

  const knownFacts = await loadKnownFacts(vaultEmail);
  console.log(`Known-facts haystack: ${knownFacts.length} chars. Scoring...`);

  const rows: Array<{ case: string; section: string; quality: number; fabrications: string[]; final: number; issues: string[] }> = [];

  for (const r of results) {
    // Haystack = vault facts + this notice's body + the bidder's own draft
    // template tokens (so "GOVCON GIANTS INC" etc. never reads as invented).
    const haystack = `${knownFacts}\n${r.body}`;
    for (const s of (r.sections || [])) {
      const fabrications = checkGrounding(s.draft, haystack).map(f => f.fact);
      const q = await judge(s.label, s.draft, r.body);
      const final = fabrications.length > 0 ? 0 : q.score;
      rows.push({ case: r.label, section: s.label, quality: q.score, fabrications, final, issues: q.issues });
      process.stdout.write(final === 0 && fabrications.length ? 'F' : final >= 90 ? '.' : 'x');
    }
  }
  console.log('');

  const scored = rows.filter(r => r.final !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.final, 0) / scored.length) : 0;
  const avgQuality = scored.length ? Math.round(scored.reduce((a, r) => a + r.quality, 0) / scored.length) : 0;
  const fabCount = rows.filter(r => r.fabrications.length > 0).length;
  const passing = rows.filter(r => r.final >= 90).length;

  // ---- report.md ----
  const md: string[] = [];
  md.push(`# Proposal Eval Report`);
  md.push(`Vault: ${vaultEmail} · sections scored: ${rows.length}`);
  md.push('');
  md.push(`## Headline`);
  md.push(`- **Avg final score: ${avg}/100** (target ≥ 90)`);
  md.push(`- Avg quality (ignoring fabrication gate): ${avgQuality}/100`);
  md.push(`- Sections with FABRICATION (auto-fail): **${fabCount}** (target 0)`);
  md.push(`- Sections ≥ 90: ${passing}/${rows.length}`);
  md.push('');
  md.push(`## Fabrications (fix these FIRST — they auto-fail the section)`);
  const fabs = rows.filter(r => r.fabrications.length > 0);
  if (!fabs.length) md.push('_None. 🎉_');
  for (const r of fabs) md.push(`- **${r.case} › ${r.section}**: ${r.fabrications.map(f => `\`${f}\``).join(', ')}`);
  md.push('');
  md.push(`## Low quality (< 90, no fabrication)`);
  for (const r of rows.filter(x => x.fabrications.length === 0 && x.final < 90).sort((a, b) => a.final - b.final)) {
    md.push(`- **${r.case} › ${r.section}** — ${r.final}/100: ${r.issues.join('; ')}`);
  }
  md.push('');
  md.push(`## Full table`);
  md.push('| Case | Section | Quality | Fabrications | Final |');
  md.push('|---|---|---|---|---|');
  for (const r of rows) md.push(`| ${r.case} | ${r.section} | ${r.quality} | ${r.fabrications.length} | ${r.final} |`);

  writeFileSync(join(__dirname, 'out', 'report.md'), md.join('\n'));
  writeFileSync(join(__dirname, 'out', 'report.json'), JSON.stringify({ avg, avgQuality, fabCount, passing, total: rows.length, rows }, null, 2));
  console.log(`\nAvg final: ${avg}/100 · fabrications: ${fabCount} · ≥90: ${passing}/${rows.length}`);
  console.log(`Report → scripts/proposal-eval/out/report.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
