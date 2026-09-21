/**
 * Proposal-eval STEP 1: generate drafts for every case using the REAL app lib
 * (generateAllSections) — no app, no auth, no clicking. This is the "render
 * separate" engine: same code Mindy runs, driven from the terminal.
 *
 * Output: scripts/proposal-eval/out/drafts.json — per-case drafted sections,
 * the source body, and timing. score.ts grades this file.
 *
 * Run:  npx tsx scripts/proposal-eval/run-eval.ts
 *       CONCURRENCY=3 npx tsx scripts/proposal-eval/run-eval.ts
 *
 * (Memory: proposal_offline_eval_harness)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { generateAllSections } from '../../src/lib/proposal/draft-all';
import type { SectionType } from '../../src/lib/proposal/types';
import { loadNoticeBody, LOI_SECTIONS, RFP_SECTIONS } from './lib';
import { noticePocGroundingText } from '../../src/lib/proposal/notice-poc';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '2', 10);

interface Case {
  notice_id: string;
  label: string;
  notice_type: string;
  naics: string | null;
  sectionSet: 'loi' | 'rfp';
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main() {
  const casesPath = join(__dirname, 'cases.json');
  const { vaultEmail, cases } = JSON.parse(readFileSync(casesPath, 'utf8')) as {
    vaultEmail: string;
    cases: Case[];
  };
  console.log(`Drafting ${cases.length} cases for vault ${vaultEmail} (concurrency ${CONCURRENCY})...`);

  const results = await pool(cases, CONCURRENCY, async (c, i) => {
    const { title, body, poc } = await loadNoticeBody(c.notice_id);
    const pocText = noticePocGroundingText(poc);
    if (body.length < 200) {
      console.log(`  [${i + 1}/${cases.length}] ${c.label} — SKIP (no body)`);
      return { ...c, title, body, pocText, sections: [], errors: [{ sectionType: 'n/a', error: 'no body text' }], ms: 0 };
    }
    const sectionTypes = (c.sectionSet === 'loi' ? LOI_SECTIONS : RFP_SECTIONS) as unknown as SectionType[];
    const t0 = Date.now();
    try {
      const res = await generateAllSections({
        email: vaultEmail,
        sourceText: body,
        fileName: `${title} — notice text`,
        sectionTypes,
        noticePoc: poc,
      });
      console.log(`  [${i + 1}/${cases.length}] ${c.label} — ${res.sections.length} sections, ${res.errors.length} errors, ${poc.all.length} POC, ${Date.now() - t0}ms`);
      return {
        ...c,
        title,
        body,
        pocText,
        sections: res.sections.map(s => ({ section: s.section, label: s.label, draft: s.draft, wordCount: s.wordCount, provider: s.meta?.model })),
        errors: res.errors,
        ms: Date.now() - t0,
      };
    } catch (e) {
      console.log(`  [${i + 1}/${cases.length}] ${c.label} — FAILED: ${e instanceof Error ? e.message : String(e)}`);
      return { ...c, title, body, pocText, sections: [], errors: [{ sectionType: 'all', error: String(e) }], ms: Date.now() - t0 };
    }
  });

  const outPath = join(__dirname, 'out', 'drafts.json');
  writeFileSync(outPath, JSON.stringify({ vaultEmail, results }, null, 2));
  console.log(`\nWrote drafts → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
