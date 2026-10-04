/**
 * LIVE oracle for capability_market_match on plain-English descriptions (ChatGPT blocker #3).
 * Runs the real tool function (unbilled, unlogged) over the fixture set and scores each case.
 *
 *   npx tsx scripts/verify-capability-match.ts [--json] [--only id,id]
 *
 * Exits 1 when any case fails. Read-only: calls USASpending/BigQuery the same way the tool does.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

(async () => {
  const args = process.argv.slice(2);
  const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
  const { CAPABILITY_PLAIN_ENGLISH_CASES } = await import('../src/lib/market/__fixtures__/capability-plain-english-cases');
  const { scoreCase } = await import('../src/lib/market/capability-plain-english-score');
  const { capabilityMarketMatch } = await import('../src/mcp/tools/capability-market-match');
  const cases = CAPABILITY_PLAIN_ENGLISH_CASES.filter((c) => !only || only.has(c.id));
  const out: unknown[] = [];
  let pass = 0;
  for (const c of cases) {
    const t0 = Date.now();
    const r = await capabilityMarketMatch({ description: c.description });
    const s = scoreCase(c, r as never);
    const ms = Date.now() - t0;
    out.push({ ...s, ms, billing_outcome: (r._meta as Record<string, unknown>).billing_outcome ?? null });
    if (s.pass) pass++;
    if (!args.includes('--json')) {
      console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(24)} ${s.tier.padEnd(9)} anchor=${JSON.stringify(s.anchor)} naics=${s.naics.join(',') || '—'} ${ms}ms${s.reasons.length ? `\n      ${s.reasons.join('\n      ')}` : ''}`);
    }
  }
  if (args.includes('--json')) console.log(JSON.stringify({ pass, total: cases.length, cases: out }, null, 2));
  else console.log(`\n${pass}/${cases.length} cases pass`);
  process.exit(pass === cases.length ? 0 : 1);
})();
