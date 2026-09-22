/**
 * READ-ONLY. Replays `findOpportunities` (the shipped library behind MCP find_opportunities)
 * over the discovery fixture set and writes a NORMALIZED snapshot: per horizon status, matched
 * count, evidence counts, error class, and the ordered identities + evidence class of the
 * returned items. No hosted MCP call, no credits.
 *
 *   npx tsx --env-file=.env.local scripts/mcp-find-replay.ts out.json
 *
 * Run it on the old tree and the new tree, then diff with scripts/mcp-find-replay-diff.ts.
 */
import { writeFileSync } from 'node:fs';
import { findOpportunities, type FindOpportunitiesInput } from '@/lib/opportunities/find-opportunities';

export const MCP_FIXTURES: Array<{ id: string; input: FindOpportunitiesInput }> = [
  ['541320', { query: '541320' }],
  ['5413', { query: '5413' }],
  ['pam', { query: 'pam' }],
  ['ai governance', { query: 'ai governance' }],
  ['artificial intelligence governance', { query: 'artificial intelligence governance' }],
  ['cybersecurity', { query: 'cybersecurity' }],
  ['janitorial', { query: 'janitorial' }],
  ['market research', { query: 'market research' }],
  ['zzzxxyyqqq', { query: 'zzzxxyyqqq' }],
  ['veterans affairs', { query: 'veterans affairs' }],
  ['janitorial + agency=VA', { query: 'janitorial', agency: 'VA' }],
  ['janitorial + agency=USDA', { query: 'janitorial', agency: 'USDA' }],
  ['management', { query: 'management' }],
  ['drones', { query: 'drones' }],
  ['"ai governance"', { query: '"ai governance"' }],
  ['8a', { query: '8a' }],
  ['follow-on support', { query: 'follow-on support' }],
  ['Show me USDA opportunities', { query: 'Show me USDA opportunities' }],
  ['SDVOSB cybersecurity opportunities in Virginia', { query: 'SDVOSB cybersecurity opportunities in Virginia' }],
  ['cyber cloud compliance network server', { query: 'cyber cloud compliance network server' }],
  ['cyber, cloud', { query: 'cyber, cloud' }],
  ['janitorial or landscaping', { query: 'janitorial or landscaping' }],
  ['Pro Audio', { query: 'Pro Audio' }],
  ['541512 -computers', { query: '541512 -computers' }],
  ['-computers', { query: '-computers' }],
  ['Naval facilities in Nevada', { query: 'Naval facilities in Nevada' }],
  ['cybersecurity + agency=SOCOM', { query: 'cybersecurity', agency: 'SOCOM' }],
  ['IT services + location=VA', { query: 'IT services', location: 'Virginia' }],
].map(([id, input]) => ({ id: id as string, input: { limit_per_horizon: 10, ...(input as FindOpportunitiesInput) } }));

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(r: any) {
  const out: any = { billing_outcome: r._meta?.billing_outcome ?? null, grounded: r._meta?.grounded, degraded: r._meta?.degraded, horizons: {} };
  for (const k of ['open_now', 'coming_back', 'coming_soon']) {
    const h = r.horizons?.[k];
    if (!h) continue;
    out.horizons[k] = {
      status: h.status,
      matched_count: h.matched_count,
      error: h.error?.class ?? null,
      evidence_counts: h.evidence_counts ?? null,
      items: (h.items || []).map((i: any) => ({ id: String(i.identity?.id), title: String(i.title || '').slice(0, 80), cls: i.evidence_class ?? null, naics: i.naics_code ?? null, buyer: i.buyer ?? null })),
    };
  }
  return out;
}

(async () => {
  const outPath = process.argv[2];
  if (!outPath) throw new Error('usage: mcp-find-replay.ts <out.json>');
  const snap: Record<string, unknown> = {};
  for (const f of MCP_FIXTURES) {
    // A replay compares SEMANTICS, so a transient DB/network failure is retried (up to 2x) rather
    // than recorded as behaviour. A failure that persists is kept and reported as unavailable.
    let res: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { res = normalize(await findOpportunities(f.input)); }
      catch (e) { res = { thrown: (e as Error).message }; }
      const failed = res.thrown || Object.values(res.horizons || {}).some((h: any) => h.error === 'query_failed');
      if (!failed) break;
      console.error(`retry ${f.id} (${attempt + 1})`);
    }
    snap[f.id] = res;
    console.error(`done ${f.id}`);
  }
  writeFileSync(outPath, JSON.stringify(snap, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
