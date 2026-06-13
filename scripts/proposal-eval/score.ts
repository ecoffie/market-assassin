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
import { guardFacts } from '../../src/lib/proposal/fact-guard';

// ---- A) Fact extraction + grounding check ---------------------------
//
// The extraction + grounding logic is the SAME code the LIVE draft pipeline
// uses (src/lib/proposal/fact-guard.ts). Importing it — rather than keeping a
// parallel copy here — is the whole point of the harness: the offline scorer
// and the in-app guard must agree on what counts as a fact, or the eval would
// pass a draft the live guard flags (or vice versa). (Memory: ground_in_real_data.)

interface Fabrication { fact: string; }

function checkGrounding(draft: string, haystack: string): Fabrication[] {
  // sanitize:false → flag only; we just want the list of ungrounded facts.
  const { unverified } = guardFacts(draft, haystack, { sanitize: false });
  return unverified.map(f => ({ fact: f.value }));
}

// ---- B) LLM judge ---------------------------------------------------

const JUDGE_SYSTEM = `You are a strict federal proposal evaluator scoring ONE drafted section of an ASSIST tool (it produces a first draft the user finalizes). Score 0-100 on:
- Responsiveness: directly anchored in THIS notice's actual scope/tasks/deliverables, not generic (40)
- Structure & format: correct for the section type, scannable (20)
- Federal voice: concrete, evidence-oriented, no fluff/GPT-tells ("in today's landscape", triple adjectives, "world-class") (20)
- Concision & relevance: on-target length, nothing padded (20)

IMPORTANT — brackets are CORRECT, not defects. This is an assist draft: a [bracketed placeholder] for a fact the bidder must supply (a phone number, a contract title, an employee count not in their profile) is the RIGHT behavior — do NOT penalize it. Penalize only INVENTED facts, generic/unanchored prose, fluff, and padding. A short honest draft that names the real scope and brackets the unknowns should score well.
Respond with JSON only: { "score": <0-100>, "issues": ["short issue", ...] }. 90+ means a strong first draft ready for the user to fill in and submit.`;

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
  ) as { vaultEmail: string; results: Array<{ label: string; notice_type: string; body: string; pocText?: string; sections: Array<{ section: string; label: string; draft: string }>; errors: unknown[] }> };

  const knownFacts = await loadKnownFacts(vaultEmail);
  console.log(`Known-facts haystack: ${knownFacts.length} chars. Scoring...`);

  const rows: Array<{ case: string; section: string; quality: number; fabrications: string[]; final: number; issues: string[] }> = [];

  for (const r of results) {
    // Haystack = vault facts + this notice's body + the government POC (name/
    // email/phone from raw_data, which is often NOT in the body) + the bidder's
    // own draft template tokens (so "GOVCON GIANTS INC" never reads as invented).
    // Without pocText, a correctly-grounded gov POC email would score as a
    // fabrication and zero out the POC section — the bug this whole change fixes.
    const haystack = `${knownFacts}\n${r.body}\n${r.pocText || ''}`;
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
