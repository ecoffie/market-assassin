#!/usr/bin/env -S npx tsx
/**
 * Agent 4 one-step release driver. STATELESS: every run rebuilds state from GitHub, takes ONE bounded
 * step, prints the decision, and exits. The caller schedules the next run; this script never sleeps long.
 *
 *   npx tsx scripts/agent-release.mts                # --dry-run (default): prints the decision, changes nothing
 *   npx tsx scripts/agent-release.mts --execute      # applies the step: lock → merge (sha-pinned) → record,
 *                                                    # or production checks → record → label
 *   [--repo owner/name] [--json]
 *
 * Decision logic, trust rules and the lock live in scripts/lib/agent-release-core.mts (tested in
 * tests/unit/agent-release.test.ts). This file only wires that logic to:
 *   - GitHub, through `gh api` (REST);
 *   - production, through fetch: the build stamp is the first maps-account-build:<sha> on /opportunity-map?cb=…,
 *     and PROD_CHECKS is Agent 4's verify-prod set;
 *   - local git, to type-check the merged tree in a throwaway worktree under .agent-release/.
 *
 * Never runs vercel. Eric's decisions (2026-11-22): dry-run is the default, --execute is for ATTENDED runs
 * from Agent 4's session only, and unattended merges stay disabled until a separate reviewer identity and
 * branch protection exist. This script schedules nothing. Eligibility = scripts/agent-release.allow.json AND
 * a valid review record; claude/team-* is always excluded.
 * Reviews are tamper-evident, not tamper-proof: every agent shares one GitHub identity.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decide, apply, stampMatches, LOCK_REF, type Port, type Pr, type Comment, type LockPayload, type Compare, type Allowlist,
} from './lib/agent-release-core.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: npx tsx scripts/agent-release.mts [--execute] [--repo owner/name] [--json]\n  default is a dry run: prints the one-step decision and changes nothing.');
  process.exit(0);
}
const EXECUTE = args.includes('--execute');
const JSON_OUT = args.includes('--json');
const repoIdx = args.indexOf('--repo');
const REPO = repoIdx >= 0 ? args[repoIdx + 1] : 'ecoffie/market-assassin';
const SITE = 'https://getmindy.ai';
const MCP = 'https://mcp.getmindy.ai';
const ROOT = process.cwd();

// ── production checks (Agent 4's verify-prod set, verbatim) ─────────────────────────────────────
// All read-only; redirects are never followed; any failure = FAIL. Never calls /api/cron/*.
type Check = { name: string; url: string; method?: 'GET' | 'POST'; expect: number[]; body?: string; headers?: Record<string, string>; locationIncludes?: string };
export const PROD_CHECKS: Check[] = [
  { name: 'VA redirect', url: `${SITE}/agencies/va`, expect: [301, 307, 308], locationIncludes: 'department-of-veterans-affairs' },
  ...['/', '/opportunity-map', '/pricing', '/mcp/setup', '/agencies/department-of-veterans-affairs'].map((path) => ({ name: `GET ${path}`, url: `${SITE}${path}`, expect: [200] })),
  { name: 'MCP OAuth metadata', url: `${MCP}/.well-known/oauth-authorization-server`, expect: [200] },
  // Auth required: 401, or 400/406 from transports that reject an empty unauthenticated body. Never 200 or 5xx.
  { name: 'MCP requires auth', url: `${MCP}/mcp`, method: 'POST', expect: [401, 400, 406], body: '{}', headers: { 'content-type': 'application/json' } },
];
const TIMEOUT_MS = 45_000;

async function runCheck(c: Check): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const r = await fetch(c.url, { method: c.method ?? 'GET', body: c.body, headers: c.headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!c.expect.includes(r.status)) return { name: c.name, ok: false, detail: `status ${r.status}, expected ${c.expect.join('/')}` };
    if (c.locationIncludes && !(r.headers.get('location') || '').includes(c.locationIncludes)) return { name: c.name, ok: false, detail: `redirects to ${r.headers.get('location') || '(none)'}` };
    return { name: c.name, ok: true, detail: `${r.status}` };
  } catch (e) {
    return { name: c.name, ok: false, detail: (e as Error).message.slice(0, 120) };
  }
}

/** The SHA production serves: first maps-account-build stamp on /opportunity-map (cache-busted). Empty = unknown. */
async function liveStamp(): Promise<string | null> {
  try {
    const html = await (await fetch(`${SITE}/opportunity-map?cb=${Math.random().toString(36).slice(2)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })).text();
    const m = html.match(/maps-account-build:([a-fA-F0-9]+)/);
    return m && m[1] ? m[1].toLowerCase() : null;
  } catch { return null; }
}

// ── GitHub ───────────────────────────────────────────────────────────────────────────────────────
function gh<T>(path: string, method = 'GET', fields: Record<string, string> = {}, input?: string): T {
  const a = ['api', '-X', method, path];
  for (const [k, v] of Object.entries(fields)) a.push('-f', `${k}=${v}`);
  if (input !== undefined) a.push('--input', '-');
  const out = execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  return (out.trim() ? JSON.parse(out) : null) as T;
}
function ghTry<T>(path: string, method = 'GET', fields: Record<string, string> = {}, input?: string): { ok: true; v: T } | { ok: false; status: number; msg: string } {
  try { return { ok: true, v: gh<T>(path, method, fields, input) }; } catch (e) {
    const msg = String((e as { stderr?: string }).stderr || (e as Error).message);
    const m = msg.match(/HTTP (\d{3})/);
    return { ok: false, status: m ? Number(m[1]) : 0, msg: msg.slice(0, 300) };
  }
}
function pages<T>(path: string, max = 10): T[] {
  const out: T[] = [];
  for (let page = 1; page <= max; page++) {
    const batch = gh<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
type RawPr = { number: number; draft: boolean; state: 'open' | 'closed'; merged?: boolean; merged_at?: string | null; merge_commit_sha?: string | null; created_at: string; head: { sha: string; ref: string }; base: { ref: string }; mergeable?: boolean | null; labels: { name: string }[] };
const toPr = (p: RawPr): Pr => ({ number: p.number, draft: p.draft, state: p.state, merged: p.merged ?? !!p.merged_at, merge_commit_sha: p.merge_commit_sha ?? null, created_at: p.created_at, head: p.head, base: p.base, mergeable: p.mergeable ?? null, labels: p.labels.map((l) => l.name) });

// ── local git: type-check the merged tree ────────────────────────────────────────────────────────
function typecheckMerged(pr: number, sha: string): { ok: boolean; detail: string } {
  const dir = join(ROOT, '.agent-release', `merge-${pr}`);
  const git = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  try {
    if (existsSync(dir)) { git('worktree', 'remove', '--force', dir); rmSync(dir, { recursive: true, force: true }); }
    mkdirSync(join(ROOT, '.agent-release'), { recursive: true });
    for (const r of [git('fetch', '--quiet', 'origin', 'main', `pull/${pr}/head`), git('worktree', 'add', '--detach', '--quiet', dir, 'origin/main')]) {
      if (r.status !== 0) return { ok: false, detail: `git: ${r.stderr.trim().slice(0, 200)}` };
    }
    const m = spawnSync('git', ['-c', 'user.name=agent-release', '-c', 'user.email=agent-release@invalid', 'merge', '--no-edit', '--quiet', sha], { cwd: dir, encoding: 'utf8' });
    if (m.status !== 0) return { ok: false, detail: `merge conflict: ${(m.stdout + m.stderr).trim().slice(0, 200)}` };
    // node_modules resolve from the repo root (the worktree lives inside it).
    const tsc = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', join(dir, 'tsconfig.json')], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (tsc.status !== 0) return { ok: false, detail: (tsc.stdout || tsc.stderr).split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 300) };
    return { ok: true, detail: 'tsc clean' };
  } finally {
    git('worktree', 'remove', '--force', dir);
  }
}

// ── the port ─────────────────────────────────────────────────────────────────────────────────────
const port: Port = {
  now: () => Date.now(),
  openPrs: async () => pages<RawPr>(`repos/${REPO}/pulls?state=open&base=main`).map((p) => {
    // The list endpoint omits `mergeable`; fetch it per PR only for builder branches (cheap filter first).
    return toPr(p);
  }),
  recentlyMergedPrs: async () => gh<RawPr[]>(`repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`).filter((p) => !!p.merged_at).map(toPr),
  pr: async (n) => toPr(gh<RawPr>(`repos/${REPO}/pulls/${n}`)),
  comments: async (n) => pages<Comment>(`repos/${REPO}/issues/${n}/comments`),
  commitDate: async (sha) => gh<{ committer: { date: string } }>(`repos/${REPO}/git/commits/${sha}`).committer.date,
  verifyState: async (sha) => {
    const runs = gh<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`).check_runs.filter((r) => r.name === 'verify');
    if (!runs.length) return 'missing';
    if (runs.some((r) => r.conclusion === 'success')) return 'success';
    if (runs.some((r) => r.status !== 'completed')) return 'pending';
    return runs.every((r) => r.conclusion === 'skipped') ? 'missing' : 'failure';
  },
  mainSha: async () => gh<{ object: { sha: string } }>(`repos/${REPO}/git/ref/heads/main`).object.sha,
  productionSha: liveStamp,
  allowlist: async () => {
    const j = JSON.parse(readFileSync(join(ROOT, 'scripts', 'agent-release.allow.json'), 'utf8')) as Partial<Allowlist>;
    return { prs: (j.prs ?? []).filter((n) => Number.isInteger(n)), branches: (j.branches ?? []).filter((b) => typeof b === 'string') };
  },
  compare: async (base, head) => gh<{ status: Compare }>(`repos/${REPO}/compare/${base}...${head}`).status,
  typecheckMerged: async (pr, sha) => typecheckMerged(pr, sha),
  prodChecks: async (expectedSha) => {
    const stamp = await liveStamp();
    const results = [{ name: 'build stamp', ok: stampMatches(stamp, expectedSha), detail: `live ${stamp ? stamp.slice(0, 12) : 'unknown'}, expected ${expectedSha.slice(0, 12)}` }];
    for (const c of PROD_CHECKS) results.push(await runCheck(c));
    return { ok: results.every((r) => r.ok), results };
  },
  merge: async (n, sha) => {
    const r = ghTry<{ merged: boolean; sha: string; message: string }>(`repos/${REPO}/pulls/${n}/merge`, 'PUT', { sha, merge_method: 'merge' });
    return r.ok ? { merged: r.v.merged, merge_commit: r.v.sha, message: r.v.message } : { merged: false, message: r.msg };
  },
  comment: async (n, body) => { gh(`repos/${REPO}/issues/${n}/comments`, 'POST', { body }); },
  addLabels: async (n, labels) => { gh(`repos/${REPO}/issues/${n}/labels`, 'POST', {}, JSON.stringify({ labels })); },
  // The lock: a ref pointing at a parentless commit whose message is the JSON payload. Creating a ref that
  // already exists fails (422), so createLock is a compare-and-swap.
  readLock: async () => {
    const ref = ghTry<{ object: { sha: string } }>(`repos/${REPO}/git/${LOCK_REF.replace(/^refs\//, 'ref/')}`);
    if (!ref.ok) return null;
    const c = gh<{ message: string }>(`repos/${REPO}/git/commits/${ref.v.object.sha}`);
    try { return JSON.parse(c.message) as LockPayload; } catch { return { owner: 'unknown', pr: 0, sha: '', expires_at: new Date(0).toISOString() }; }
  },
  createLock: async (p) => {
    const tree = gh<{ sha: string }>(`repos/${REPO}/git/trees`, 'POST', {}, JSON.stringify({ tree: [{ path: 'LOCK', mode: '100644', type: 'blob', content: JSON.stringify(p) }] }));
    const commit = gh<{ sha: string }>(`repos/${REPO}/git/commits`, 'POST', {}, JSON.stringify({ message: JSON.stringify(p), tree: tree.sha, parents: [] }));
    const r = ghTry(`repos/${REPO}/git/refs`, 'POST', {}, JSON.stringify({ ref: LOCK_REF, sha: commit.sha }));
    if (r.ok) return true;
    if (r.status === 422) return false; // already exists → someone else holds it
    throw new Error(`lock create failed: ${r.msg}`);
  },
  deleteLock: async () => { ghTry(`repos/${REPO}/git/${LOCK_REF}`, 'DELETE'); },
};

// Mergeability is only computed on the single-PR endpoint (and lazily): refresh allowlisted candidates,
// polling up to ~60 s while GitHub computes it. Everything else stays as listed.
const baseOpen = port.openPrs;
port.openPrs = async () => {
  const allow = await port.allowlist();
  return Promise.all((await baseOpen()).map(async (p) => {
    if (p.draft || !(allow.prs.includes(p.number) || allow.branches.includes(p.head.ref))) return p;
    let fresh = await port.pr(p.number);
    for (let i = 0; i < 12 && fresh.mergeable === null; i++) { await new Promise((r) => setTimeout(r, 5_000)); fresh = await port.pr(p.number); }
    return fresh;
  }));
};

const decision = await decide(port);
const result = EXECUTE ? await apply(port, decision) : null;
if (JSON_OUT) {
  console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', decision, result }, null, 2));
} else {
  console.log(`[agent-release] ${EXECUTE ? 'EXECUTE' : 'dry-run'} · ${decision.kind}${decision.pr ? ` #${decision.pr}` : ''}`);
  for (const r of decision.reasons) console.log(`  · ${r}`);
  for (const a of decision.actions) console.log(`  ${EXECUTE ? '→' : 'would'} ${a.do}${'pr' in a ? ` #${a.pr}` : ''}`);
  if (result) { for (const a of result.applied) console.log(`  done: ${a}`); if (result.stopped) console.log(`  stopped: ${result.stopped}`); }
  if (!EXECUTE && decision.actions.length) console.log('  (dry-run: nothing changed; re-run with --execute to apply)');
}
