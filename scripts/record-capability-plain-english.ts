/**
 * Records the LIVE inputs the plain-English hermetic test replays: for every fixture case, the
 * derived keyword list and the keyword coverage of every phrase the tool would probe.
 *
 *   caffeinate -i npx tsx scripts/record-capability-plain-english.ts
 *
 * Writes src/lib/market/__fixtures__/capability-plain-english-recorded.json. Read-only upstream.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { writeFileSync } from 'node:fs';

(async () => {
  const { CAPABILITY_PLAIN_ENGLISH_CASES } = await import('../src/lib/market/__fixtures__/capability-plain-english-cases');
  const { deriveCompanyKeywords } = await import('../src/mcp/tools/company-keywords');
  const { rankAnchorCandidates, normalizeSelectedAnchor } = await import('../src/lib/market/capability-anchor');
  const { keywordCoverage } = await import('../src/lib/market/keyword-coverage');
  const out: Record<string, { keywords: string[]; coverage: Record<string, unknown> }> = {};
  for (const c of CAPABILITY_PLAIN_ENGLISH_CASES) {
    const kw = await deriveCompanyKeywords({ description: c.description, limit: 25 });
    const keywords = (kw as { keywords?: string[] }).keywords ?? [];
    // Record coverage for EVERY surviving candidate (not just the probed ones), so a ranking
    // change can be replayed without a new recording.
    const phrases = [...new Set(rankAnchorCandidates(keywords, { sourceText: c.description }).filter((r) => r.score >= 0).map((r) => normalizeSelectedAnchor(r.phrase)))];
    const coverage: Record<string, unknown> = {};
    await Promise.all(phrases.map(async (p) => {
      const cov = await keywordCoverage(p, 0.9).catch(() => null);
      coverage[p] = cov ? { totalMarket: cov.totalMarket, naicsCount: cov.naicsCount, allNaics: cov.allNaics.slice(0, 5).map((n) => ({ code: n.code, name: n.name, amount: n.amount, pct: n.pct })), topPscList: (cov.topPscList ?? []).slice(0, 3) } : null;
    }));
    out[c.id] = { keywords, coverage };
    console.log(c.id, keywords.length, 'keywords,', phrases.length, 'phrases');
  }
  writeFileSync('src/lib/market/__fixtures__/capability-plain-english-recorded.json', JSON.stringify({ recorded_at: new Date().toISOString(), cases: out }, null, 1) + '\n');
})();
