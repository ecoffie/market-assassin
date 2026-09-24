/**
 * Recompete compute-once rollout — the CONTROLLED PRODUCTION SAMPLE driver (Gate 2, 2026-09-24).
 *
 * Sends real requests to the live /api/app/recompete-map across every category the rollout must cover
 * (text · NAICS/PSC · agency · multi-agency · state · exclusions · Maps-only filters · viewports ·
 * selective and broad markets). With the operator token it FORCES the path so the organic sampling
 * rate never has to rise:
 *   --force shadow   serve the PostgREST path, compare compute-once in the background (shadow stage)
 *   --force new      serve compute-once, verify against PostgREST in the background (canary stage)
 *   (no --force)     plain requests — whatever the configured mode decides (authority timing)
 * Every comparison lands in recompete_compute_once_log; read it with scripts/recompete-rollout-report.ts.
 *
 *   npx tsx scripts/recompete-rollout-sample.ts --force shadow [--host https://getmindy.ai] [--concurrency 2] [--repeat 1]
 */
import 'dotenv/config';
import { FIXTURES } from '@/lib/discovery/__fixtures__/fixtures';

type Case = { cat: string; id: string; params: Record<string, string>; bbox: string };
const V = {
  CONUS: '-125,24,-66.9,49.6', DC: '-77.2,38.8,-76.9,39.0', TEXAS: '-98,29,-94,33', CALIFORNIA: '-124,32,-114,42',
  OCEAN: '-40,10,-30,20', ALASKA: '-170,50,-129,72', HAWAII: '-161,18,-154,23',
};
const BROAD = 'program management, training, technical writing, logistics, data analytics, systems engineering';

export function rolloutCases(): Case[] {
  const c: Case[] = [];
  const add = (cat: string, id: string, params: Record<string, string>, bbox = V.CONUS) => c.push({ cat, id, params, bbox });
  for (const f of FIXTURES) {
    const inp = f.input as unknown as Record<string, string>;
    const p: Record<string, string> = {};
    if (inp.query) p.q = inp.query;
    if (inp.agency) p.agency = inp.agency;
    add(`canonical:${f.cls}`, f.id, p);
  }
  add('text:broad', 'broad capability list', { q: BROAD });
  add('text:nonsense', 'xqzvplk florbnax', { q: 'xqzvplk florbnax' });
  add('text:selective', 'fire alarm inspection', { q: 'fire alarm inspection' });
  add('text:selective', 'elevator maintenance', { q: 'elevator maintenance' });
  add('text:broad', 'construction', { q: 'construction' });
  add('naics', 'naics 541512', { naics: '541512' });
  add('naics', 'naics 236220', { naics: '236220' });
  add('naics', 'naics prefix 5415', { naics: '5415' });
  add('naics', 'naics multi 541511,541512', { naics: '541511,541512' });
  add('psc', 'psc D302', { psc: 'D302' });
  add('psc', 'psc R425', { psc: 'R425' });
  add('psc', 'psc S201 + janitorial', { psc: 'S201', q: 'janitorial' });
  add('agency', 'agency DHS', { agency: 'DHS' });
  add('agency', 'agency NASA + software license', { agency: 'NASA', q: 'software license' });
  add('multi-agency', 'VA|USDA', { agency: 'VA|USDA' });
  add('multi-agency', 'DHS|DOJ + cybersecurity', { agency: 'DHS|DOJ', q: 'cybersecurity' });
  add('multi-agency', 'Army|Navy|Air Force', { agency: 'Army|Navy|Air Force' });
  add('state', 'state FL', { state: 'FL' });
  add('state', 'state FL,GA + janitorial', { state: 'FL,GA', q: 'janitorial' });
  add('state', 'text in Virginia', { q: 'cybersecurity in Virginia' });
  add('exclusion', 'janitorial -snow', { q: 'janitorial -snow' });
  add('exclusion', 'software license -microsoft', { q: 'software license -microsoft' });
  add('maps-filter', 'setAside SB-Total + 541512', { naics: '541512', setAside: 'SB-Total' });
  add('maps-filter', 'setAside 8(a) + cybersecurity', { q: 'cybersecurity', setAside: '8(a)' });
  add('maps-filter', 'subAgency Veterans + janitorial', { q: 'janitorial', subAgency: 'Veterans' });
  add('maps-filter', 'value 1M-50M + cybersecurity', { q: 'cybersecurity', minValue: '1000000', maxValue: '50000000' });
  add('maps-filter', 'sap friendly + 541512', { naics: '541512', sap: 'friendly' });
  add('maps-filter', 'sap gated + software license', { q: 'software license', sap: 'gated' });
  add('maps-filter', 'likelihood high + 236220', { naics: '236220', likelihood: 'high' });
  add('maps-filter', 'leadMax 6 + cybersecurity', { q: 'cybersecurity', leadMax: '6' });
  add('maps-filter', 'everything at once', { q: 'cybersecurity', setAside: 'SB-Total', minValue: '100000', sap: 'friendly', likelihood: 'high', leadMax: '12' });
  for (const [vn, bb] of Object.entries(V)) {
    if (vn === 'CONUS') continue;
    add(`viewport:${vn}`, `janitorial @${vn}`, { q: 'janitorial' }, bb);
    add(`viewport:${vn}`, `541512 @${vn}`, { naics: '541512' }, bb);
    add(`viewport:${vn}`, `broad @${vn}`, { q: BROAD }, bb);
  }
  return c;
}

async function main() {
  const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const host = arg('--host') || 'https://getmindy.ai';
  const force = arg('--force');
  const concurrency = Number(arg('--concurrency') || 2);
  const repeat = Number(arg('--repeat') || 1);
  const token = process.env.CRON_SECRET || '';
  if (force && !token) throw new Error('--force needs CRON_SECRET');
  const cases = rolloutCases();
  const jobs = Array.from({ length: repeat }, () => cases).flat();
  const started = new Date().toISOString();
  const results: Array<{ cat: string; id: string; status: number; path: string | null; ms: number; total: unknown }> = [];
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const j = jobs[i++];
      const qs = new URLSearchParams({ bbox: j.bbox, ...j.params }).toString();
      const t0 = Date.now();
      const res = await fetch(`${host}/api/app/recompete-map?${qs}`, {
        headers: force ? { 'x-recompete-force': force, 'x-recompete-verify': token } : {},
      });
      const body = await res.json().catch(() => ({}));
      results.push({ cat: j.cat, id: j.id, status: res.status, path: res.headers.get('x-recompete-path'), ms: Date.now() - t0, total: (body as { totalForFilters?: unknown }).totalForFilters });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const bad = results.filter((r) => r.status !== 200);
  const paths = results.reduce<Record<string, number>>((a, r) => { a[r.path || '?'] = (a[r.path || '?'] || 0) + 1; return a; }, {});
  console.log(JSON.stringify({ started, finished: new Date().toISOString(), host, force, requests: results.length, non200: bad.length, servedPaths: paths }, null, 1));
  if (bad.length) console.log('non-200:', bad.slice(0, 10));
}
if (process.argv[1]?.endsWith('recompete-rollout-sample.ts')) main().catch((e) => { console.error(e); process.exit(1); });
